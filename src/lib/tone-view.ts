/*
 * The Tone card on the export page (docs/design/Tone_mockup.html): a tab per
 * person, a graphic EQ drawn on the framework's frequency graph (speech
 * target, the voice before and with the EQ, the EQ curve, a spectrum while
 * previewing) with ten faders, and a compressor drawn as its transfer curve.
 *
 * On a phone all ten faders fit; a finger swept across them draws the curve,
 * and the dots on the graph can be dragged too. Settings live in `state` and
 * every change calls `onChange`.
 */
import { FREQ_LABELS, curvePath, dbLabel, freqGrid, freqLabel, freqPos, type Point } from './graph';
import { BANDS, COMP_PRESETS, EQ_PRESETS, EQ_RANGE, compCurve, eqResponse, matchToTarget, speechTarget, type VoiceTone } from './audio/tone';
import { curveOf } from './audio/spectrum';

export interface ToneVoice {
  key: string;
  name: string;
  role: string;
  color: string;
}

const NS = 'http://www.w3.org/2000/svg';
const FREQS = Array.from({ length: 240 }, (_, i) => 20 * 1000 ** (i / 239));
const minus = (s: string) => s.replace(/-/g, '−');
const signed = (d: number) => (d > 0 ? `+${d}` : minus(String(d)));
function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>, parent?: Element) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.append(e);
  return e;
}
const label = (svg: Element, text: string, attrs: Record<string, string | number>) => {
  const t = el('text', { fill: 'var(--color-text-3)', 'font-family': 'var(--font-mono)', 'font-size': 10, ...attrs }, svg);
  t.textContent = text;
};

export function mountTone(root: HTMLElement, voices: ToneVoice[], state: Record<string, VoiceTone>, o: { rate: number; spectrum: (key: string) => Promise<Point[]>; onChange: (key: string) => void }) {
  const q = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  let key = voices[0].key;
  let view: 'eq' | 'comp' = 'eq';
  const cur = () => state[key];
  const voice = () => voices.find((v) => v.key === key)!;
  const spectra: Record<string, ((f: number) => number) | null> = {};
  let live: Point[] | null = null; // the spectrum while previewing
  let nowIn: number | null = null; // the voice's level into the compressor while previewing
  let active: number | null = null;
  let activeTimer = 0;

  // ── Tabs ──
  const tabs = q('[data-tone-voices]');
  tabs.replaceChildren(
    ...voices.map((v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.voice = v.key;
      b.className = 'flex h-8 items-center justify-center gap-2 rounded-[7px] px-3.5 text-[14px] whitespace-nowrap text-text-2 hover:text-text aria-pressed:bg-text aria-pressed:font-medium aria-pressed:text-page';
      b.innerHTML = `<span class="size-2 flex-none rounded-full"></span><span data-n></span><span class="font-mono text-[11px] tracking-[0.06em] uppercase opacity-70" data-r></span>`;
      (b.firstElementChild as HTMLElement).style.background = v.color;
      b.querySelector('[data-n]')!.textContent = v.name;
      b.querySelector('[data-r]')!.textContent = v.role;
      b.addEventListener('click', () => {
        key = v.key;
        live = null;
        nowIn = null;
        measure();
        draw();
      });
      return b;
    }),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-tone-view]').forEach((b) =>
    b.addEventListener('click', () => {
      view = b.dataset.toneView as 'eq' | 'comp';
      draw();
    }),
  );

  // ── The voice's long-term spectrum, measured once per person ──
  const status = q('[data-tone-status]');
  async function measure() {
    const k = key;
    if (k in spectra) return;
    spectra[k] = null;
    status.textContent = `Measuring ${voice().name}'s voice…`;
    try {
      const pts = await o.spectrum(k);
      spectra[k] = pts.length ? curveOf(pts) : null;
    } catch {
      spectra[k] = null;
    }
    if (k === key) status.textContent = spectra[k] ? '' : 'Not enough speech to measure this voice.';
    draw();
  }

  const change = () => {
    o.onChange(key);
    draw();
  };
  function setBand(i: number, v: number) {
    v = Math.max(-EQ_RANGE, Math.min(EQ_RANGE, Math.round(v)));
    active = i;
    clearTimeout(activeTimer);
    const t = cur();
    if (t.eq.gains[i] !== v || !t.eq.on) {
      t.eq.gains[i] = v;
      t.eq.preset = null;
      t.eq.on = true;
      change();
    } else draw();
  }
  const release = () => {
    clearTimeout(activeTimer);
    activeTimer = window.setTimeout(() => {
      active = null;
      draw();
    }, 900);
  };

  // ── EQ graph ──
  const eqBox = q('[data-tone-eq-plot]');
  const eqSvg = q('[data-tone-eq-svg]');
  const eqHit = q('[data-tone-eq-hit]');
  let geo: { L: number; T: number; w: number; h: number; x: (f: number) => number; y: (d: number) => number } | null = null;
  function drawEq() {
    const W = eqBox.clientWidth, H = eqBox.clientHeight;
    if (!W || !H) return;
    const L = 34, B = 22, T = 8, R = 8, w = W - L - R, h = H - T - B;
    const x = (f: number) => L + freqPos(f) * w;
    const y = (d: number) => T + ((24 - Math.max(-24, Math.min(24, d))) / 48) * h;
    geo = { L, T, w, h, x, y };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: '100%', role: 'img', 'aria-label': `${voice().name}: EQ and voice` });
    const defs = el('defs', {}, svg);
    const g = el('linearGradient', { id: 'tone-sp', x1: 0, x2: w, y1: 0, y2: 0, gradientUnits: 'userSpaceOnUse' }, defs);
    for (const [off, c] of [[0, 'var(--color-rec)'], [0.08, 'var(--color-warn)'], [0.9, 'var(--color-warn)'], [1, 'var(--color-rec)']] as const) el('stop', { offset: off, 'stop-color': c }, g);
    el('clipPath', { id: 'tone-clip' }, defs).append(el('rect', { width: w, height: h }));
    el('rect', { x: L, y: T, width: w, height: h, fill: 'var(--color-plot)' }, svg);
    const { major, minor } = freqGrid();
    for (const f of minor) el('line', { x1: x(f), x2: x(f), y1: T, y2: T + h, stroke: 'var(--color-divider)' }, svg);
    for (const f of major) el('line', { x1: x(f), x2: x(f), y1: T, y2: T + h, stroke: 'var(--color-border)' }, svg);
    for (let d = 24; d >= -24; d -= 6) el('line', { x1: L, x2: L + w, y1: y(d), y2: y(d), stroke: d === 0 ? 'var(--color-handle)' : 'var(--color-border)' }, svg);
    for (let d = 18; d >= -18; d -= 6) label(svg, dbLabel(d), { x: L - 6, y: y(d) + 3.5, 'text-anchor': 'end' });
    for (const f of w < 380 ? [100, 500, 2000, 10000] : FREQ_LABELS) label(svg, freqLabel(f), { x: x(f), y: T + h + 15, 'text-anchor': 'middle' });
    const plot = el('g', { transform: `translate(${L} ${T})`, 'clip-path': 'url(#tone-clip)' }, svg);
    const t = cur();
    const eqFn = (f: number) => (t.eq.on ? eqResponse(f, t.eq.gains, o.rate) : 0);
    const pts = (fn: (f: number) => number): Point[] => FREQS.map((f) => [f, fn(f)]);
    const path = (p: Point[], attrs: Record<string, string | number>) => el('path', { d: curvePath(p, w, h), fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...attrs }, plot);
    if (live) path(live, { stroke: 'url(#tone-sp)', 'stroke-width': 1.25, opacity: 0.85, 'data-spectrum': '' });
    const eq = pts(eqFn);
    el('path', { d: `${curvePath(eq, w, h)} L${w} ${h / 2} L0 ${h / 2} Z`, fill: 'var(--color-text)', opacity: 0.06 }, plot);
    path(eq, { stroke: 'var(--color-text-2)', 'stroke-width': 1.5, 'data-eq': '' });
    path(pts(speechTarget), { stroke: 'var(--color-text)', 'stroke-width': 2 });
    const v = spectra[key];
    if (v) {
      path(pts(v), { stroke: voice().color, 'stroke-width': 1.5, opacity: 0.4 });
      path(pts((f) => v(f) + eqFn(f)), { stroke: voice().color, 'stroke-width': 2, 'data-voice': '' });
    }
    BANDS.forEach((fc, i) => {
      if (fc >= o.rate * 0.45) return;
      el('circle', { cx: x(fc), cy: y(eqFn(fc)), r: active === i ? 6 : 4, fill: active === i ? 'var(--color-text)' : 'var(--color-text-2)', stroke: 'var(--color-plot)', 'stroke-width': 2 }, svg);
    });
    if (active != null) {
      const txt = el('text', { x: L + 10, y: T + 18, fill: 'var(--color-text)', 'font-family': 'var(--font-mono)', 'font-size': 12 }, svg);
      txt.textContent = `${freqLabel(BANDS[active])} Hz · ${t.eq.gains[active] ? signed(t.eq.gains[active]) : '0'} dB`;
    }
    eqSvg.replaceChildren(svg);
  }

  // Dragging on the graph moves from where it started; sliding sideways moves to the next band.
  // The hit layer above the SVG takes the input, since the SVG is redrawn on every change.
  const bandAt = (cx: number, cy: number) => {
    const r = eqBox.getBoundingClientRect(), px = cx - r.left, py = cy - r.top, g = geo!;
    let i = 0;
    BANDS.forEach((fc, k) => {
      if (fc < o.rate * 0.45 && Math.abs(g.x(fc) - px) < Math.abs(g.x(BANDS[i]) - px)) i = k;
    });
    const t = cur();
    const near = Math.hypot(g.x(BANDS[i]) - px, g.y(t.eq.on ? eqResponse(BANDS[i], t.eq.gains, o.rate) : 0) - py) < 32;
    return { i, near };
  };
  let drag: { i: number; y0: number; g0: number } | null = null;
  const dragAt = (cx: number, cy: number) => {
    const { i } = bandAt(cx, cy);
    if (i !== drag!.i) drag = { i, y0: cy, g0: cur().eq.gains[i] };
    setBand(drag!.i, drag!.g0 + ((drag!.y0 - cy) / geo!.h) * 48);
  };
  const dragStart = (cx: number, cy: number) => {
    const { i } = bandAt(cx, cy);
    drag = { i, y0: cy, g0: cur().eq.gains[i] };
    setBand(i, drag.g0);
  };
  const dragEnd = () => {
    if (!drag) return;
    drag = null;
    release();
  };
  eqHit.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || !geo) return;
    e.preventDefault();
    dragStart(e.clientX, e.clientY);
  });
  document.addEventListener('pointermove', (e) => drag && e.pointerType !== 'touch' && dragAt(e.clientX, e.clientY));
  document.addEventListener('pointerup', (e) => e.pointerType !== 'touch' && dragEnd());
  // Touch: only from near a dot, so the page still scrolls over the graph.
  eqHit.addEventListener(
    'touchstart',
    (e) => {
      if (!geo) return;
      const t = e.touches[0];
      if (!bandAt(t.clientX, t.clientY).near) return;
      e.preventDefault();
      dragStart(t.clientX, t.clientY);
    },
    { passive: false },
  );
  document.addEventListener(
    'touchmove',
    (e) => {
      if (!drag) return;
      e.preventDefault();
      dragAt(e.touches[0].clientX, e.touches[0].clientY);
    },
    { passive: false },
  );
  document.addEventListener('touchend', dragEnd);
  document.addEventListener('touchcancel', dragEnd);

  // ── Faders: one finger across the row takes each band it passes to its height ──
  const bands = q('[data-tone-bands]');
  const faders = BANDS.map((fc, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'flex min-w-0 flex-col items-center gap-2 rounded-[10px] py-1.5 transition-colors data-[active]:bg-control';
    wrap.innerHTML = `<span class="font-mono text-[11px] tabular-nums sm:text-[13px]" data-v></span>
      <div class="relative h-[150px] w-full max-w-10 cursor-ns-resize" role="slider" tabindex="0" aria-label="${freqLabel(fc)} Hz" aria-valuemin="-12" aria-valuemax="12" data-f>
        <span class="absolute inset-y-0 left-[calc(50%-2px)] w-1 rounded-full bg-border"></span>
        <span class="absolute top-1/2 right-[20%] left-[20%] h-px bg-handle"></span>
        <span class="absolute left-[calc(50%-2px)] w-1 rounded-full bg-text" data-fill></span>
        <span class="absolute left-[calc(50%-8px)] -mt-2 size-4 rounded-full bg-text" data-knob></span>
      </div>
      <span class="font-mono text-[10px] text-text-3 sm:text-[11px]">${freqLabel(fc)}</span>`;
    bands.append(wrap);
    const f = wrap.querySelector<HTMLElement>('[data-f]')!;
    if (fc >= o.rate * 0.45) wrap.style.opacity = '0.3';
    f.addEventListener('dblclick', () => (setBand(i, 0), release()));
    f.addEventListener('keydown', (e) => {
      const step = ({ ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 } as Record<string, number>)[e.key];
      if (step) {
        e.preventDefault();
        setBand(i, cur().eq.gains[i] + step);
        release();
      }
      if (e.key === '0') setBand(i, 0);
    });
    return () => {
      const v = cur().eq.gains[i];
      wrap.toggleAttribute('data-active', active === i);
      const val = wrap.querySelector<HTMLElement>('[data-v]')!;
      val.textContent = v ? signed(v) : '0';
      val.style.color = v ? 'var(--color-text)' : 'var(--color-text-3)';
      f.setAttribute('aria-valuenow', String(v));
      f.setAttribute('aria-valuetext', `${minus(String(v))} dB`);
      const pos = (EQ_RANGE - v) / (2 * EQ_RANGE);
      wrap.querySelector<HTMLElement>('[data-knob]')!.style.top = `${pos * 100}%`;
      const fill = wrap.querySelector<HTMLElement>('[data-fill]')!;
      fill.style.top = `${Math.min(pos, 0.5) * 100}%`;
      fill.style.height = `${Math.abs(pos - 0.5) * 100}%`;
    };
  });
  const sweep = (e: PointerEvent) => {
    const rects = [...bands.querySelectorAll<HTMLElement>('[data-f]')].map((f) => f.getBoundingClientRect());
    let i = rects.findIndex((r, k) => e.clientX < (k < rects.length - 1 ? (r.right + rects[k + 1].left) / 2 : Infinity));
    if (i < 0) i = rects.length - 1;
    setBand(i, EQ_RANGE - ((e.clientY - rects[i].top) / rects[i].height) * 2 * EQ_RANGE);
  };
  bands.addEventListener('pointerdown', (e) => {
    if (!(e.target as HTMLElement).closest('[data-f]')) return;
    bands.setPointerCapture(e.pointerId);
    sweep(e);
  });
  bands.addEventListener('pointermove', (e) => bands.hasPointerCapture(e.pointerId) && sweep(e));
  for (const ev of ['pointerup', 'pointercancel']) bands.addEventListener(ev, release);

  // ── Presets, Match, Reset, on/off ──
  const eqPresets = q('[data-tone-presets]');
  for (const name of Object.keys(EQ_PRESETS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.preset = name;
    b.className = 'flex h-8 items-center justify-center rounded-[7px] px-3 text-[14px] whitespace-nowrap text-text-2 hover:text-text aria-pressed:bg-text aria-pressed:font-medium aria-pressed:text-page';
    b.textContent = name;
    b.addEventListener('click', () => {
      cur().eq = { on: name !== 'Flat', gains: [...EQ_PRESETS[name]], preset: name };
      change();
    });
    eqPresets.append(b);
  }
  q('[data-tone-match]').addEventListener('click', () => {
    const v = spectra[key];
    if (!v) return;
    cur().eq = { on: true, gains: matchToTarget(v), preset: null };
    change();
  });
  q('[data-tone-reset]').addEventListener('click', () => {
    cur().eq = { on: false, gains: [...EQ_PRESETS.Flat], preset: 'Flat' };
    change();
  });
  q<HTMLInputElement>('[name=tone-eq-on]').addEventListener('change', (e) => {
    cur().eq.on = (e.target as HTMLInputElement).checked;
    change();
  });

  // ── Compressor ──
  const compBox = q('[data-tone-comp-plot]');
  const fmt: Record<string, (v: number) => string> = { threshold: (v) => `${minus(String(v))} dB`, ratio: (v) => `${v}:1`, knee: (v) => `${v} dB`, makeup: (v) => `+${v} dB` };
  const ranges = ['threshold', 'ratio', 'knee', 'makeup'] as const;
  for (const k of ranges)
    q<HTMLInputElement>(`[name=tone-${k}]`).addEventListener('input', (e) => {
      cur().comp[k] = Number((e.target as HTMLInputElement).value);
      cur().comp.preset = null;
      cur().comp.on = true;
      change();
    });
  const compPresets = q('[data-tone-comp-presets]');
  for (const name of Object.keys(COMP_PRESETS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.preset = name;
    b.className = 'flex h-8 items-center justify-center rounded-[7px] px-3 text-[14px] whitespace-nowrap text-text-2 hover:text-text aria-pressed:bg-text aria-pressed:font-medium aria-pressed:text-page';
    b.textContent = name;
    b.addEventListener('click', () => {
      cur().comp = { on: true, ...COMP_PRESETS[name], preset: name };
      change();
    });
    compPresets.append(b);
  }
  q<HTMLInputElement>('[name=tone-comp-on]').addEventListener('change', (e) => {
    cur().comp.on = (e.target as HTMLInputElement).checked;
    change();
  });
  function drawComp() {
    const W = compBox.clientWidth, H = compBox.clientHeight;
    if (!W || !H) return;
    const L = 34, B = 22, T = 8, R = 8, w = W - L - R, h = H - T - B;
    const x = (d: number) => L + ((d + 60) / 60) * w;
    const y = (d: number) => T + (-Math.max(-60, Math.min(0, d)) / 60) * h;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: '100%', role: 'img', 'aria-label': `${voice().name}: compressor` });
    el('clipPath', { id: 'tone-cclip' }, el('defs', {}, svg)).append(el('rect', { x: L, y: T, width: w, height: h }));
    el('rect', { x: L, y: T, width: w, height: h, fill: 'var(--color-plot)' }, svg);
    for (let d = -60; d <= 0; d += 6) {
      const stroke = d % 12 === 0 ? 'var(--color-border)' : 'var(--color-divider)';
      el('line', { x1: x(d), x2: x(d), y1: T, y2: T + h, stroke }, svg);
      el('line', { x1: L, x2: L + w, y1: y(d), y2: y(d), stroke }, svg);
    }
    for (let d = -48; d <= 0; d += 12) {
      label(svg, minus(String(d)), { x: L - 6, y: y(d) + 3.5, 'text-anchor': 'end' });
      label(svg, minus(String(d)), { x: x(d), y: T + h + 15, 'text-anchor': 'middle' });
    }
    label(svg, 'IN', { x: L + w - 4, y: T + h - 6, 'text-anchor': 'end', 'letter-spacing': '0.06em' });
    label(svg, 'OUT', { x: L + 6, y: T + 14, 'letter-spacing': '0.06em' });
    const plot = el('g', { 'clip-path': 'url(#tone-cclip)' }, svg);
    const c = cur().comp;
    const out = (d: number) => (c.on ? compCurve(d, c) + c.makeup : d);
    el('line', { x1: x(-60), y1: y(-60), x2: x(0), y2: y(0), stroke: 'var(--color-handle)', 'stroke-width': 1.5 }, plot);
    if (c.on) el('line', { x1: x(c.threshold), x2: x(c.threshold), y1: T, y2: T + h, stroke: 'var(--color-text-3)', 'stroke-dasharray': '3 4' }, plot);
    const d: string[] = [];
    for (let v = -60; v <= 0.001; v += 0.5) d.push(`${d.length ? 'L' : 'M'}${x(v).toFixed(1)} ${y(out(v)).toFixed(1)}`);
    el('path', { d: d.join(' '), fill: 'none', stroke: 'var(--color-text)', 'stroke-width': 2, 'stroke-linejoin': 'round' }, plot);
    if (c.on) label(svg, `THRESHOLD ${minus(String(c.threshold))}`, { x: Math.min(x(c.threshold) + 6, L + w - 96), y: T + 14, 'letter-spacing': '0.06em' });
    if (nowIn != null) el('circle', { cx: x(nowIn), cy: y(out(nowIn)), r: 5, fill: voice().color, stroke: 'var(--color-plot)', 'stroke-width': 2 }, plot);
    compBox.replaceChildren(svg);
    const gr = c.on && nowIn != null ? compCurve(nowIn, c) - nowIn : 0;
    q('[data-tone-gr]').textContent = nowIn == null ? '—' : minus(gr.toFixed(1));
    q('[data-tone-gr-bar]').style.width = `${Math.min(100, (-gr / 18) * 100)}%`;
  }

  // ── Everything that shows the current person's settings ──
  const press = (group: Element, attr: string, value: string | null) => group.querySelectorAll<HTMLElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
  function draw() {
    const t = cur();
    press(tabs, 'voice', key);
    root.querySelectorAll<HTMLElement>('[data-tone-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.toneView === view)));
    q('[data-tone-eq]').hidden = view !== 'eq';
    q('[data-tone-comp]').hidden = view !== 'comp';
    press(eqPresets, 'preset', t.eq.on || t.eq.preset === 'Flat' ? t.eq.preset : null);
    press(compPresets, 'preset', t.comp.on ? t.comp.preset : null);
    q<HTMLInputElement>('[name=tone-eq-on]').checked = t.eq.on;
    q<HTMLInputElement>('[name=tone-comp-on]').checked = t.comp.on;
    q<HTMLButtonElement>('[data-tone-match]').disabled = !spectra[key];
    root.querySelectorAll<HTMLElement>('[data-tone-voice-color]').forEach((e) => (e.style.background = voice().color));
    q('[data-tone-name]').textContent = voice().name;
    for (const k of ranges) {
      const input = q<HTMLInputElement>(`[name=tone-${k}]`);
      input.value = String(t.comp[k]);
      q(`[data-tone-${k}]`).textContent = fmt[k](t.comp[k]);
    }
    faders.forEach((f) => f());
    if (view === 'eq') drawEq();
    else drawComp();
  }
  new ResizeObserver(() => draw()).observe(root);
  measure();
  draw();

  return {
    get key() {
      return key;
    },
    /** While previewing: this person's spectrum right now (relative dB) and their level into the compressor. */
    live(spectrum: Point[] | null, level: number | null) {
      live = spectrum;
      nowIn = level;
      if (view === 'eq') drawEq();
      else drawComp();
    },
    redraw: draw,
  };
}
