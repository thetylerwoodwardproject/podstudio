<!--
  Export step 03, Tone: a graphic EQ and a compressor for each person,
  applied to their cleaned edit before the leveller and the mix
  (lib/audio/tone.ts). The flow (ExportFlow.svelte) owns the preview and
  feeds this the voice's spectrum and level as it plays.

  On a phone all ten faders fit; a finger swept across them draws the curve,
  and the dots on the graph can be dragged too. The compressor's presets are
  on top; "More" opens its curve and controls.
-->
<script lang="ts" module>
  export interface ToneVoice {
    key: string;
    name: string;
    role: string;
    color: string;
  }
</script>

<script lang="ts">
  import { FREQ_LABELS, curvePath, dbLabel, freqGrid, freqLabel, freqPos, type Point } from '@/lib/graph';
  import { BANDS, COMP_HELP, COMP_PRESETS, EQ_PRESETS, EQ_RANGE, compCurve, eqResponse, matchToTarget, speechTarget, type VoiceTone } from '@/lib/audio/tone';
  import { curveOf } from '@/lib/audio/spectrum';
  import Segmented from '@/components/ui/Segmented.svelte';
  import StatusDot from '@/components/ui/StatusDot.svelte';

  interface Props {
    voices: ToneVoice[];
    /** Everyone's settings, changed in place */
    tones: Record<string, VoiceTone>;
    rate: number;
    /** A person's long-term spectrum, measured from their take */
    spectrum: (key: string) => Promise<Point[]>;
    /** After every change */
    onchange: () => void;
  }
  let { voices, tones = $bindable(), rate, spectrum, onchange }: Props = $props();
  const settings = $derived(tones);
  // svelte-ignore state_referenced_locally
  let key = $state(voices[0].key);
  let view = $state<'eq' | 'comp'>('eq');
  const t = $derived(settings[key]);
  const voice = $derived(voices.find((v) => v.key === key)!);

  // ── The voice's long-term spectrum, measured once per person ──
  const spectra = $state<Record<string, ((f: number) => number) | null>>({});
  let status = $state('');
  $effect(() => {
    const k = key;
    if (k in spectra) return;
    spectra[k] = null;
    status = `Measuring ${voices.find((v) => v.key === k)!.name}'s voice…`;
    spectrum(k)
      .then((pts) => (spectra[k] = pts.length ? curveOf(pts) : null))
      .catch(() => (spectra[k] = null))
      .finally(() => {
        if (k === key) status = spectra[k] ? '' : 'Not enough speech to measure this voice.';
      });
  });

  // While previewing (set by the page): this person's spectrum now, and their level into the compressor.
  let live = $state<Point[] | null>(null);
  let nowIn = $state<number | null>(null);
  export function preview(spectrum: Point[] | null, level: number | null) {
    live = spectrum;
    nowIn = level;
  }
  export const currentKey = () => key;

  const changed = () => onchange();

  // ── Bands ──
  let active = $state<number | null>(null);
  let activeTimer = 0;
  const usable = (fc: number) => fc < rate * 0.45;
  function setBand(i: number, v: number) {
    v = Math.max(-EQ_RANGE, Math.min(EQ_RANGE, Math.round(v)));
    active = i;
    clearTimeout(activeTimer);
    if (t.eq.gains[i] === v && t.eq.on) return;
    t.eq.gains[i] = v;
    t.eq.preset = null;
    t.eq.on = true;
    changed();
  }
  const release = () => {
    clearTimeout(activeTimer);
    activeTimer = window.setTimeout(() => (active = null), 900);
  };
  const signed = (d: number) => (d > 0 ? `+${d}` : String(d).replace('-', '−'));

  // One finger (or the mouse) across the row: each band it passes takes its height.
  let bandsEl: HTMLElement;
  function sweep(e: PointerEvent) {
    const rects = [...bandsEl.querySelectorAll<HTMLElement>('[data-f]')].map((f) => f.getBoundingClientRect());
    let i = rects.findIndex((r, k) => e.clientX < (k < rects.length - 1 ? (r.right + rects[k + 1].left) / 2 : Infinity));
    if (i < 0) i = rects.length - 1;
    setBand(i, EQ_RANGE - ((e.clientY - rects[i].top) / rects[i].height) * 2 * EQ_RANGE);
  }
  function faderKey(e: KeyboardEvent, i: number) {
    const step = ({ ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 } as Record<string, number>)[e.key];
    if (step) {
      e.preventDefault();
      setBand(i, t.eq.gains[i] + step);
      release();
    }
    if (e.key === '0') setBand(i, 0);
  }

  // ── EQ graph ──
  const FREQS = Array.from({ length: 240 }, (_, i) => 20 * 1000 ** (i / 239));
  const grid = freqGrid();
  let eqW = $state(0);
  let eqH = $state(0);
  const L = 34, T = 8;
  const pw = $derived(Math.max(0, eqW - L - 8));
  const ph = $derived(Math.max(0, eqH - T - 22));
  const gx = (f: number) => L + freqPos(f) * pw;
  const gy = (d: number) => T + ((24 - Math.max(-24, Math.min(24, d))) / 48) * ph;
  const eqAt = (f: number) => (t.eq.on ? eqResponse(f, t.eq.gains, rate) : 0);
  const curve = (fn: (f: number) => number) => curvePath(FREQS.map((f): Point => [f, fn(f)]), pw, ph);
  const eqPath = $derived(curve(eqAt));
  const targetPath = $derived(curve(speechTarget));
  const before = $derived(spectra[key] ? curve(spectra[key]!) : '');
  const after = $derived(spectra[key] ? curve((f) => spectra[key]!(f) + eqAt(f)) : '');
  const livePath = $derived(live ? curvePath(live, pw, ph) : '');

  // Dragging on the graph moves from where it started; sliding sideways moves to the next band.
  // A layer over the SVG takes the input, so a redraw never strands a touch.
  let eqBox: HTMLElement;
  function bandAt(cx: number, cy: number) {
    const r = eqBox.getBoundingClientRect();
    const px = cx - r.left, py = cy - r.top;
    let i = 0;
    BANDS.forEach((fc, k) => {
      if (usable(fc) && Math.abs(gx(fc) - px) < Math.abs(gx(BANDS[i]) - px)) i = k;
    });
    return { i, near: Math.hypot(gx(BANDS[i]) - px, gy(eqAt(BANDS[i])) - py) < 32 };
  }
  let drag: { i: number; y0: number; g0: number } | null = null;
  function dragStart(cx: number, cy: number) {
    const { i } = bandAt(cx, cy);
    drag = { i, y0: cy, g0: t.eq.gains[i] };
    setBand(i, drag.g0);
  }
  function dragAt(cx: number, cy: number) {
    if (!drag) return;
    const { i } = bandAt(cx, cy);
    if (i !== drag.i) drag = { i, y0: cy, g0: t.eq.gains[i] };
    setBand(drag.i, drag.g0 + ((drag.y0 - cy) / ph) * 48);
  }
  function dragEnd() {
    if (!drag) return;
    drag = null;
    release();
  }
  $effect(() => {
    const move = (e: PointerEvent) => e.pointerType !== 'touch' && dragAt(e.clientX, e.clientY);
    const up = (e: PointerEvent) => e.pointerType !== 'touch' && dragEnd();
    const tmove = (e: TouchEvent) => {
      if (!drag) return;
      e.preventDefault();
      dragAt(e.touches[0].clientX, e.touches[0].clientY);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('touchmove', tmove, { passive: false });
    document.addEventListener('touchend', dragEnd);
    document.addEventListener('touchcancel', dragEnd);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('touchmove', tmove);
      document.removeEventListener('touchend', dragEnd);
      document.removeEventListener('touchcancel', dragEnd);
    };
  });
  // Touch only starts a drag near a dot, so the page still scrolls over the graph.
  function touchStart(e: TouchEvent) {
    const p = e.touches[0];
    if (!bandAt(p.clientX, p.clientY).near) return;
    e.preventDefault();
    dragStart(p.clientX, p.clientY);
  }
  $effect(() => {
    // Svelte's ontouchstart is passive; this one has to be able to stop the scroll.
    eqBox.addEventListener('touchstart', touchStart, { passive: false });
    return () => eqBox.removeEventListener('touchstart', touchStart);
  });

  // ── Presets ──
  function eqPreset(name: string) {
    settings[key].eq = { on: name !== 'Flat', gains: [...EQ_PRESETS[name]], preset: name };
    changed();
  }
  function match() {
    const v = spectra[key];
    if (!v) return;
    settings[key].eq = { on: true, gains: matchToTarget(v), preset: null };
    changed();
  }
  function compPreset(name: string) {
    settings[key].comp = name === 'Off' ? { ...settings[key].comp, on: false } : { on: true, ...COMP_PRESETS[name], preset: name };
    changed();
  }
  const eqChoice = $derived(t.eq.on ? (t.eq.preset ?? 'Custom') : 'Flat');
  const compChoice = $derived(t.comp.on ? (t.comp.preset ?? 'Custom') : 'Off');

  // ── Compressor ──
  const sliders = [
    { key: 'threshold', label: 'Threshold', min: -40, max: 0, step: 1, fmt: (v: number) => `${String(v).replace('-', '−')} dB` },
    { key: 'ratio', label: 'Ratio', min: 1, max: 10, step: 0.5, fmt: (v: number) => `${v}:1` },
    { key: 'knee', label: 'Knee', min: 0, max: 18, step: 1, fmt: (v: number) => `${v} dB` },
    { key: 'makeup', label: 'Make-up gain', min: 0, max: 12, step: 0.5, fmt: (v: number) => `+${v} dB` },
  ] as const;
  function setComp(k: (typeof sliders)[number]['key'], v: number) {
    t.comp[k] = v;
    t.comp.preset = null;
    t.comp.on = true;
    changed();
  }
  let cW = $state(0);
  let cH = $state(0);
  const cw = $derived(Math.max(0, cW - L - 8));
  const ch = $derived(Math.max(0, cH - T - 22));
  const cx = (d: number) => L + ((d + 60) / 60) * cw;
  const cy = (d: number) => T + (-Math.max(-60, Math.min(0, d)) / 60) * ch;
  const compOut = (d: number) => (t.comp.on ? compCurve(d, t.comp) + t.comp.makeup : d);
  const compPath = $derived(Array.from({ length: 121 }, (_, i) => -60 + i / 2).map((d, i) => `${i ? 'L' : 'M'}${cx(d).toFixed(1)} ${cy(compOut(d)).toFixed(1)}`).join(' '));
  const gr = $derived(t.comp.on && nowIn != null ? compCurve(nowIn, t.comp) - nowIn : 0);
  const compLines = Array.from({ length: 11 }, (_, i) => -60 + i * 6);

  const tag = 'font-mono text-[11px] font-medium tracking-[0.06em] text-text-3 uppercase';
  const eqOptions = $derived([...Object.keys(EQ_PRESETS), ...(eqChoice === 'Custom' ? ['Custom'] : [])].map((v) => ({ value: v, label: v })));
  const compOptions = $derived([...Object.keys(COMP_HELP), ...(compChoice === 'Custom' ? ['Custom'] : [])].map((v) => ({ value: v, label: v })));
  const minus = (s: string) => s.replace(/-/g, '−');
</script>


<div class="flex min-w-0 flex-col gap-5" data-tone>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex flex-wrap gap-2" role="group" aria-label="Whose tone" data-tone-voices>
      {#each voices as v (v.key)}
        <button
          type="button"
          class="flex h-[34px] items-center gap-2 rounded-[9px] border px-3 text-[14px] {v.key === key ? 'border-handle bg-control text-text' : 'border-border text-text-2 hover:text-text'}"
          data-voice={v.key}
          aria-pressed={v.key === key}
          onclick={() => ((key = v.key), (live = null), (nowIn = null))}
        >
          <StatusDot color={v.color} />{v.name}
          <span class={tag}>{v.role}</span>
        </button>
      {/each}
    </div>
    <Segmented label="View" value={view} options={[{ value: 'eq', label: 'Graphic EQ' }, { value: 'comp', label: 'Compressor' }]} data-tone-view onchange={(v) => (view = v as 'eq' | 'comp')} />
  </div>

  <!-- Graphic EQ -->
  <div class="flex min-w-0 flex-col gap-[18px] rounded-[14px] bg-surface p-5" data-tone-eq hidden={view !== 'eq'}>
    <ul class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-text-2">
      <li class="flex items-center gap-2"><span class="h-0.5 w-4 rounded-full bg-text"></span>Speech target</li>
      <li class="flex items-center gap-2"><span class="h-0.5 w-4 rounded-full opacity-40" style:background={voice.color}></span>Voice before</li>
      <li class="flex items-center gap-2"><span class="h-0.5 w-4 rounded-full" style:background={voice.color}></span>With EQ</li>
      <li class="flex items-center gap-2"><span class="h-0.5 w-4 rounded-full bg-text-2"></span>EQ</li>
      <li class="flex items-center gap-2"><span class="h-0.5 w-4 rounded-full bg-warn"></span>Spectrum</li>
    </ul>
    <div class="relative h-[150px] min-w-0 sm:h-[240px]" data-tone-eq-plot bind:this={eqBox} bind:clientWidth={eqW} bind:clientHeight={eqH}>
      <div class="h-full" data-tone-eq-svg>
        {#if pw > 0 && ph > 0}
          <svg width="100%" height="100%" viewBox={`0 0 ${eqW} ${eqH}`} role="img" aria-label={`${voice.name}: EQ and voice`}>
            <defs>
              <linearGradient id="tone-sp" x1="0" x2={pw} y1="0" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="var(--color-rec)" />
                <stop offset="0.08" stop-color="var(--color-warn)" />
                <stop offset="0.9" stop-color="var(--color-warn)" />
                <stop offset="1" stop-color="var(--color-rec)" />
              </linearGradient>
              <clipPath id="tone-clip"><rect width={pw} height={ph} /></clipPath>
            </defs>
            <rect x={L} y={T} width={pw} height={ph} fill="var(--color-plot)" />
            {#each grid.minor as f}<line x1={gx(f)} x2={gx(f)} y1={T} y2={T + ph} stroke="var(--color-divider)" />{/each}
            {#each grid.major as f}<line x1={gx(f)} x2={gx(f)} y1={T} y2={T + ph} stroke="var(--color-border)" />{/each}
            {#each [24, 12, 0, -12, -24] as d}
              <line x1={L} x2={L + pw} y1={gy(d)} y2={gy(d)} stroke={d === 0 ? 'var(--color-handle)' : 'var(--color-border)'} />
              {#if Math.abs(d) < 24}<text x={L - 6} y={gy(d) + 3.5} text-anchor="end" fill="var(--color-text-3)" font-family="var(--font-mono)" font-size="10">{dbLabel(d)}</text>{/if}
            {/each}
            {#each pw < 380 ? [100, 500, 2000, 10000] : FREQ_LABELS as f}
              <text x={gx(f)} y={T + ph + 15} text-anchor="middle" fill="var(--color-text-3)" font-family="var(--font-mono)" font-size="10">{freqLabel(f)}</text>
            {/each}
            <g transform={`translate(${L} ${T})`} clip-path="url(#tone-clip)">
              {#if livePath}<path d={livePath} fill="none" stroke="url(#tone-sp)" stroke-width="1.25" opacity="0.85" data-spectrum />{/if}
              <path d={`${eqPath} L${pw} ${ph / 2} L0 ${ph / 2} Z`} fill="var(--color-text)" opacity="0.06" />
              <path d={eqPath} fill="none" stroke="var(--color-text-2)" stroke-width="1.5" stroke-linejoin="round" data-eq />
              <path d={targetPath} fill="none" stroke="var(--color-text)" stroke-width="2" stroke-linejoin="round" />
              {#if before}
                <path d={before} fill="none" stroke={voice.color} stroke-width="1.5" opacity="0.4" stroke-linejoin="round" />
                <path d={after} fill="none" stroke={voice.color} stroke-width="2" stroke-linejoin="round" data-voice />
              {/if}
            </g>
            {#each BANDS as fc, i}
              {#if usable(fc)}
                <circle cx={gx(fc)} cy={gy(eqAt(fc))} r={active === i ? 6 : 4} fill={active === i ? 'var(--color-text)' : 'var(--color-text-2)'} stroke="var(--color-plot)" stroke-width="2" />
              {/if}
            {/each}
            {#if active != null}
              <text x={L + 10} y={T + 18} fill="var(--color-text)" font-family="var(--font-mono)" font-size="12">{freqLabel(BANDS[active])} Hz · {t.eq.gains[active] ? signed(t.eq.gains[active]) : '0'} dB</text>
            {/if}
          </svg>
        {/if}
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="absolute inset-0 cursor-crosshair"
        data-tone-eq-hit
        onpointerdown={(e) => {
          if (e.pointerType === 'touch') return;
          e.preventDefault();
          dragStart(e.clientX, e.clientY);
        }}
      ></div>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <Segmented label="EQ preset" value={eqChoice} options={eqOptions} class="max-w-full overflow-x-auto" data-tone-presets onchange={(v) => v !== 'Custom' && eqPreset(v)} />
      <div class="flex items-center gap-2">
        <button type="button" class="h-9 rounded-[10px] border border-border px-3.5 text-[14px] whitespace-nowrap text-text hover:border-handle disabled:opacity-40" data-tone-match disabled={!spectra[key]} onclick={match}>Match to target</button>
        <button type="button" class="h-9 rounded-[10px] px-3 text-[14px] text-text-2 hover:text-text" data-tone-reset onclick={() => eqPreset('Flat')}>Reset</button>
      </div>
    </div>
    <div
      class="grid touch-none grid-cols-10 gap-0.5 select-none"
      data-tone-bands
      bind:this={bandsEl}
      role="group"
      aria-label="EQ bands"
      onpointerdown={(e) => {
        if (!(e.target as HTMLElement).closest('[data-f]')) return;
        bandsEl.setPointerCapture(e.pointerId);
        sweep(e);
      }}
      onpointermove={(e) => bandsEl.hasPointerCapture(e.pointerId) && sweep(e)}
      onpointerup={release}
      onpointercancel={release}
    >
      {#each BANDS as fc, i}
        {@const v = t.eq.gains[i]}
        {@const pos = (EQ_RANGE - v) / (2 * EQ_RANGE)}
        <div class="flex min-w-0 flex-col items-center gap-2 rounded-[10px] py-1.5 transition-colors data-[active]:bg-control" data-active={active === i ? '' : undefined} style:opacity={usable(fc) ? null : 0.3}>
          <span class="font-mono text-[11px] tabular-nums sm:text-[12px]" style:color={v ? 'var(--color-text)' : 'var(--color-text-3)'} data-v>{v ? signed(v) : '0'}</span>
          <div
            class="relative h-[120px] w-full max-w-10 cursor-ns-resize"
            role="slider"
            tabindex="0"
            aria-label={`${freqLabel(fc)} Hz`}
            aria-valuemin={-EQ_RANGE}
            aria-valuemax={EQ_RANGE}
            aria-valuenow={v}
            aria-valuetext={`${minus(String(v))} dB`}
            data-f
            ondblclick={() => (setBand(i, 0), release())}
            onkeydown={(e) => faderKey(e, i)}
          >
            <span class="absolute inset-y-0 left-[calc(50%-2px)] w-1 rounded-full bg-border"></span>
            <span class="absolute top-1/2 right-[20%] left-[20%] h-px bg-handle"></span>
            <span class="absolute left-[calc(50%-2px)] w-1 rounded-full bg-text" style:top={`${Math.min(pos, 0.5) * 100}%`} style:height={`${Math.abs(pos - 0.5) * 100}%`}></span>
            <span class="absolute left-[calc(50%-8px)] -mt-2 size-4 rounded-full bg-text" style:top={`${pos * 100}%`}></span>
          </div>
          <span class="font-mono text-[10px] text-text-3 sm:text-[11px]">{freqLabel(fc)}</span>
        </div>
      {/each}
    </div>
    <p class="help">
      Drag a band, or sweep across them; double-click to reset one. <b class="font-medium text-text">Match to target</b> suggests bands that bring {voice.name} toward the
      speech target, by up to <span class="font-mono text-[12px] whitespace-nowrap">6 dB</span> each. {status}
    </p>
  </div>

  <!-- Compressor -->
  <div class="flex min-w-0 flex-col gap-3.5 rounded-[14px] bg-surface p-5" data-tone-comp hidden={view !== 'comp'}>
    <span class="text-[14px]">Compression</span>
    <Segmented label="Compression" value={compChoice} options={compOptions} data-tone-comp-presets onchange={(v) => v !== 'Custom' && compPreset(v)} />
    <p class="help" data-tone-comp-help>{compChoice === 'Custom' ? 'Your own settings, under More.' : COMP_HELP[compChoice]}</p>
    <details class="group border-t border-divider pt-3.5" data-tone-more>
      <summary class="flex cursor-pointer list-none items-center gap-2 text-[14px] text-text-2 hover:text-text [&::-webkit-details-marker]:hidden">
        <span class="inline-block transition-transform group-open:rotate-90">›</span>More
      </summary>
      <div class="mt-4 flex flex-col gap-4">
        <ul class="flex flex-wrap items-center gap-4 text-[12px] text-text-2">
          <li class="flex items-center gap-2"><span class="h-0.5 w-4 rounded-full bg-handle"></span>No change (1:1)</li>
          <li class="flex items-center gap-2"><span class="h-0.5 w-4 rounded-full bg-text"></span>Compressor</li>
          <li class="flex items-center gap-2"><StatusDot color={voice.color} />The voice now</li>
        </ul>
        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div class="h-[240px] min-w-0 lg:h-[280px]" data-tone-comp-plot bind:clientWidth={cW} bind:clientHeight={cH}>
            {#if cw > 0 && ch > 0}
              <svg width="100%" height="100%" viewBox={`0 0 ${cW} ${cH}`} role="img" aria-label={`${voice.name}: compressor`}>
                <defs><clipPath id="tone-cclip"><rect x={L} y={T} width={cw} height={ch} /></clipPath></defs>
                <rect x={L} y={T} width={cw} height={ch} fill="var(--color-plot)" />
                {#each compLines as d}
                  <line x1={cx(d)} x2={cx(d)} y1={T} y2={T + ch} stroke={d % 12 === 0 ? 'var(--color-border)' : 'var(--color-divider)'} />
                  <line x1={L} x2={L + cw} y1={cy(d)} y2={cy(d)} stroke={d % 12 === 0 ? 'var(--color-border)' : 'var(--color-divider)'} />
                {/each}
                {#each [-48, -36, -24, -12, 0] as d}
                  <text x={L - 6} y={cy(d) + 3.5} text-anchor="end" fill="var(--color-text-3)" font-family="var(--font-mono)" font-size="10">{minus(String(d))}</text>
                  <text x={cx(d)} y={T + ch + 15} text-anchor="middle" fill="var(--color-text-3)" font-family="var(--font-mono)" font-size="10">{minus(String(d))}</text>
                {/each}
                <text x={L + cw - 4} y={T + ch - 6} text-anchor="end" letter-spacing="0.06em" fill="var(--color-text-3)" font-family="var(--font-mono)" font-size="10">IN</text>
                <text x={L + 6} y={T + 14} letter-spacing="0.06em" fill="var(--color-text-3)" font-family="var(--font-mono)" font-size="10">OUT</text>
                <g clip-path="url(#tone-cclip)">
                  <line x1={cx(-60)} y1={cy(-60)} x2={cx(0)} y2={cy(0)} stroke="var(--color-handle)" stroke-width="1.5" />
                  {#if t.comp.on}<line x1={cx(t.comp.threshold)} x2={cx(t.comp.threshold)} y1={T} y2={T + ch} stroke="var(--color-text-3)" stroke-dasharray="3 4" />{/if}
                  <path d={compPath} fill="none" stroke="var(--color-text)" stroke-width="2" stroke-linejoin="round" />
                  {#if nowIn != null}<circle cx={cx(nowIn)} cy={cy(compOut(nowIn))} r="5" fill={voice.color} stroke="var(--color-plot)" stroke-width="2" />{/if}
                </g>
                {#if t.comp.on}
                  <text x={Math.min(cx(t.comp.threshold) + 6, L + cw - 96)} y={T + 14} letter-spacing="0.06em" fill="var(--color-text-3)" font-family="var(--font-mono)" font-size="10">THRESHOLD {minus(String(t.comp.threshold))}</text>
                {/if}
              </svg>
            {/if}
          </div>
          <div class="flex flex-col gap-5">
            {#each sliders as s}
              <label class="flex flex-col gap-2.5">
                <span class="flex items-baseline justify-between text-[14px]">
                  {s.label}
                  <span class="font-mono text-[13px]" data-tone-slider={s.key}>{s.fmt(t.comp[s.key])}</span>
                </span>
                <input type="range" name={`tone-${s.key}`} min={s.min} max={s.max} step={s.step} class="w-full" value={t.comp[s.key]} oninput={(e) => setComp(s.key, Number(e.currentTarget.value))} />
              </label>
            {/each}
            <div class="flex flex-col gap-2">
              <span class={tag}>Gain reduction</span>
              <span class="font-mono text-[22px] leading-none"><span data-tone-gr>{nowIn == null ? '—' : minus(gr.toFixed(1))}</span><span class="text-[12px] text-text-3"> dB</span></span>
              <span class="flex h-1.5 flex-row-reverse overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--color-warn)_20%,var(--color-meter-off))]">
                <span class="h-full rounded-full bg-warn" style:width={`${Math.min(100, (-gr / 18) * 100)}%`}></span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </details>
  </div>
</div>
