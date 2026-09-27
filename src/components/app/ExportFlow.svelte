<!--
  The Export page as a step flow (design: docs/design/step-flow/): Edit →
  Noise → Tone → Loudness → Export, one decision per step, in the order the
  audio is processed. The player at the bottom plays 30 s of the episode
  through everything up to the step, with a before and after for the step
  itself (lib/audio/chain-preview.ts), so Tone and Loudness are heard on the
  cleaned audio.

  The page (pages/episodes/[id]/session.astro) loads the takes, keeps the
  settings for the episode and makes the zip; this is the screen.
-->
<script lang="ts" module>
  import type { PauseMode } from '@/lib/audio/assemble';
  import type { VoiceTone } from '@/lib/audio/tone';
  import type { Loudness } from '@/lib/audio/chain-preview';

  export interface ExportSettings {
    assembled: boolean;
    /** Marker tones in the full recording */
    tones: boolean;
    pauses: PauseMode;
    /** Rough mix (with pads) */
    mix: boolean;
    ns: number;
    voices: Record<string, VoiceTone>;
    loudness: Loudness;
    level: boolean;
  }
  export interface FlowState {
    settings: ExportSettings;
    step: number;
    reached: number;
    /** Files ticked or unticked in the picker this visit, by name */
    picks?: Record<string, boolean>;
  }
  export interface ExportInfo {
    /** Marker counts, "3 retakes · 1 pause" */
    counts: string;
    tonesAvailable: boolean;
    /** Which markers get a tone, "retake and cough" */
    toneKinds: string;
    /** The Pads track's description, or null with no pads */
    pads: string | null;
    /** How the tracks were lined up (with a guest) */
    sync: string;
    guestMissing: { name: string; href: string } | null;
    /** Show the loudness graph (Settings → Recording) */
    meter: boolean;
    /** The design's example data: nothing plays or exports */
    demo: boolean;
  }
  export interface ExportResult {
    measured: Measured | null;
    files: number;
    bytes: number;
    filename: string;
    /** Download the same zip again without processing the audio a second time. */
    downloadAgain: () => void;
  }
  export interface Measured {
    integrated: number;
    range: number | null;
    peak: number;
    history: number[];
    seconds: number;
    parts: number;
  }
</script>

<script lang="ts">
  import { tick as flush } from 'svelte';
  import StepPage from '@/components/steps/StepPage.svelte';
  import StepPlayer from '@/components/steps/StepPlayer.svelte';
  import ToneStep, { type ToneVoice } from '@/components/steps/ToneStep.svelte';
  import LoudnessGraph from '@/components/steps/LoudnessGraph.svelte';
  import Switch from '@/components/ui/Switch.svelte';
  import Segmented from '@/components/ui/Segmented.svelte';
  import { AFTER, AB, targetOf, type ChainPreview, type StageResult, type StepId } from '@/lib/audio/chain-preview';
  import { PreviewPlayer } from '@/lib/audio/preview-player';
  import { suggestAmount } from '@/lib/audio/denoise-core';
  import type { Point } from '@/lib/graph';
  import ExportPicker from '@/components/app/ExportPicker.svelte';
  import { formatSize, picked, type ExportFile } from '@/lib/export-files';

  interface Props {
    sessionsHref: string;
    initial: FlowState;
    info: ExportInfo;
    voices: ToneVoice[];
    rate: number;
    /** "Removes 6:52." for the edit's switch */
    removes: (s: ExportSettings) => string;
    /** Every file these settings make (lib/export-files.ts), and why some aren't there */
    plan: (s: ExportSettings) => { files: ExportFile[]; notes: string[] };
    /** The kinds of file saved with "Use this selection every time", or none */
    saved: string[] | null;
    onsave: (kinds: string[] | null) => void;
    spectrum: (key: string) => Promise<Point[]>;
    /** The room's noise floor, dBFS */
    floor: () => Promise<number>;
    /** The preview for the edit these settings make */
    chain: (s: ExportSettings) => ChainPreview;
    onchange: (state: FlowState) => void;
    /** Make the zip with just these files */
    onexport: (s: ExportSettings, names: string[], progress: (text: string) => void) => Promise<ExportResult | null>;
    onmarkers: () => void;
  }
  let { sessionsHref, initial, info, voices, rate, removes, plan, saved: savedKinds, onsave, spectrum, floor, chain, onchange, onexport, onmarkers }: Props = $props();

  const STEPS: { id: StepId; label: string; title: string; lede: string }[] = [
    { id: 'edit', label: 'Edit', title: 'Edit', lede: 'Choose what the assembled edit keeps. The raw WAV always goes in the zip untouched.' },
    { id: 'noise', label: 'Noise', title: 'Background noise', lede: 'Clean the room first. EQ and compression shape your voice, but they can’t take out fans, hum or traffic.' },
    { id: 'tone', label: 'Tone', title: 'Tone', lede: 'Shape each voice. You’re hearing it on the cleaned audio, so boosts won’t bring the noise back up.' },
    { id: 'loud', label: 'Loudness', title: 'Loudness', lede: 'Set the episode to podcast level, measured on everything before it.' },
    { id: 'export', label: 'Export', title: 'Export', lede: 'Check the chain, then pick what goes in the zip.' },
  ];

  // The saved state to start from; from here the flow keeps its own and reports changes.
  // svelte-ignore state_referenced_locally
  const settings = $state(structuredClone(initial.settings));
  // svelte-ignore state_referenced_locally
  let step = $state(Math.min(initial.step, STEPS.length - 1));
  // svelte-ignore state_referenced_locally
  let reached = $state(Math.max(initial.reached, initial.step));
  const id = $derived(STEPS[step].id);
  $effect(() => onchange({ settings: $state.snapshot(settings) as ExportSettings, step, reached, picks: $state.snapshot(picks) }));

  const M = '−';
  const minus = (s: string) => s.replace(/-/g, M);
  const fmt = (d: number | null | undefined) => (d != null && Number.isFinite(d) ? minus(d.toFixed(1)) : '—');
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const TARGET_TEXT: Record<string, string> = { stereo: `${M}16 LUFS`, mono: `${M}19 LUFS`, off: 'Peaks only' };

  // ── The preview ──
  const player = new PreviewPlayer();
  let playing = $state(false);
  let pos = $state(0);
  let dur = $state(0);
  // svelte-ignore state_referenced_locally
  let choice = $state(AFTER[STEPS[step].id]);
  let result = $state.raw<StageResult | null>(null);
  /** The settings the result was made with */
  let builtWith = $state.raw<ExportSettings | null>(null);
  let status = $state('');
  let toneStep = $state<ReturnType<typeof ToneStep> | null>(null);
  let gen = 0;
  let timer = 0;

  /** Everything the current step's preview depends on. */
  const stageKey = () => {
    const s = settings;
    return JSON.stringify([s.assembled, s.pauses, s.loudness, step >= 1 ? s.ns : 0, step >= 2 ? s.voices : 0, step >= 3 ? s.level : 0, step]);
  };

  async function build() {
    const my = ++gen;
    const key = stageKey();
    const s = $state.snapshot(settings) as ExportSettings;
    try {
      const r = await chain(s).stage(id, { ns: s.ns, tones: s.voices, loudness: s.loudness, level: s.level }, (t) => my === gen && (status = t));
      if (my !== gen) return;
      result = r;
      builtWith = s;
      status = '';
      player.set(r.audio);
      player.select(choice);
      dur = player.duration;
      if (stageKey() !== key) later();
    } catch (err) {
      if (my === gen) status = `Couldn’t preview: ${(err as Error).message}`;
    }
  }
  const later = () => {
    clearTimeout(timer);
    timer = window.setTimeout(build, 300);
  };
  // A setting changed: a preview already made for this step is made again, and keeps playing.
  let lastKey = '';
  $effect(() => {
    const key = stageKey();
    if (key === lastKey) return;
    lastKey = key;
    if (result) later();
  });

  function go(i: number) {
    if (i > reached || exporting) return;
    completed = null;
    measured = null;
    gen++;
    clearTimeout(timer);
    player.reset();
    player.set(null);
    playing = false;
    pos = 0;
    dur = 0;
    result = null;
    status = '';
    step = i;
    choice = AFTER[STEPS[i].id];
    player.select(choice);
    toneStep?.preview(null, null);
    lastKey = stageKey();
    // The Loudness step's readouts need the preview, so it's made straight away.
    if (STEPS[i].id === 'loud' && !info.demo) build();
  }
  // svelte-ignore state_referenced_locally
  if (STEPS[step].id === 'loud' && !info.demo) build();

  function tick() {
    playing = player.playing;
    pos = player.position();
    if (!playing) return;
    if (result?.tone && toneStep) {
      const v = result.tone.voiceAt(toneStep.currentKey(), pos);
      toneStep.preview(v.spectrum, v.level);
    }
    requestAnimationFrame(tick);
  }
  player.onended = () => {
    playing = false;
    pos = 0;
    toneStep?.preview(null, null);
  };
  async function toggle() {
    if (player.playing) {
      player.pause();
      playing = false;
      toneStep?.preview(null, null);
      return;
    }
    if (!result) await build();
    if (!result) return;
    await player.play();
    tick();
  }
  function choose(i: number) {
    choice = i;
    player.select(i);
  }

  const chainOf = (upto: number) => {
    const parts: string[] = [];
    if (upto >= 0) parts.push(settings.assembled ? 'Edit' : 'Raw');
    if (upto >= 1 && settings.ns) parts.push(`Noise ${settings.ns} %`);
    if (upto >= 2) parts.push('Tone');
    if (upto >= 3) parts.push(TARGET_TEXT[settings.loudness]);
    return parts.join(' → ');
  };
  const chainText = $derived(
    status ||
      (id === 'noise' && choice === 2 ? 'Only the removed noise' : id === 'export' ? (choice ? chainOf(3) : 'Raw WAV') : choice >= 1 ? chainOf(step) : chainOf(step - 1) || 'Raw'),
  );

  // ── Noise ──
  let room = $state<number | null | undefined>(undefined);
  let measuring = false;
  $effect(() => {
    if (id !== 'noise' || measuring) return;
    measuring = true;
    floor()
      .then((f) => (room = Number.isFinite(f) ? f : null))
      .catch(() => (room = null));
  });
  const suggested = $derived(room == null ? 0 : suggestAmount(room));
  const roomText = $derived(
    room === undefined
      ? 'Measuring the quiet stretches between lines…'
      : room === null
        ? 'Not enough quiet between lines to measure it.'
        : suggested === 0
          ? 'Measured in the quiet stretches between lines. That’s a quiet room; you may not need it.'
          : suggested <= 40
            ? `Measured in the quiet stretches between lines. That’s audible fan and hum, so ${suggested} % is a good start.`
            : `Measured in the quiet stretches between lines. That’s a noisy room, so ${suggested} % is a good start.`,
  );
  /** How far the background comes down: measured by the preview, or the fader's estimate */
  const reduction = $derived(
    !settings.ns ? 0 : result?.reduction != null && builtWith?.ns === settings.ns ? Math.round(result.reduction) : Math.round(Math.min(40, settings.ns * 0.4)),
  );

  // ── Loudness ──
  const loud = $derived(result?.loud ?? null);
  const readouts = $derived([
    { k: 'Measured', v: fmt(loud?.before.meter?.integrated), u: 'LUFS' },
    { k: 'After', v: fmt(loud?.after.meter?.integrated), u: 'LUFS' },
    { k: 'True peak', v: fmt(loud?.after.meter?.peak), u: 'dBTP' },
  ]);

  // ── Export ──
  let exporting = $state<string | null>(null);
  let measured = $state<Measured | null>(null);
  let completed = $state.raw<ExportResult | null>(null);
  let skipGuest = $state(false);
  const waiting = $derived(!!info.guestMissing && !skipGuest);
  const toneShort = (t: VoiceTone) =>
    `${!t.eq.on ? 'Flat' : (t.eq.preset ?? 'Custom')} EQ, ${!t.comp.on ? 'no' : (t.comp.preset ?? 'custom').toLowerCase()} compression`;
  const summary = $derived([
    { label: 'Edit', value: settings.assembled ? `Assembled, pauses ${{ cut: 'cut', keep: 'kept', split: 'split' }[settings.pauses]}` : 'Raw only' },
    { label: 'Noise', value: settings.ns ? `${settings.ns} %, background ${M}${reduction} dB` : 'Off' },
    {
      label: 'Tone',
      value: voices.length > 1 ? voices.map((v) => `${v.name}: ${toneShort(settings.voices[v.key])}`).join(' · ') : toneShort(settings.voices[voices[0].key]),
    },
    {
      label: 'Loudness',
      value: `${{ stereo: 'Stereo', mono: 'Mono', off: 'Off' }[settings.loudness]}, ${TARGET_TEXT[settings.loudness]}${settings.level ? ', speakers levelled' : ''}`,
    },
  ]);

  // ── The files: every one the chain makes, ticked or not (ExportPicker) ──
  // svelte-ignore state_referenced_locally
  let picks = $state<Record<string, boolean>>(initial.picks ?? {});
  // svelte-ignore state_referenced_locally
  let saved = $state<string[] | null>(savedKinds);
  let picking = $state(false);
  const planned = $derived(plan(settings));
  const chosen = $derived(planned.files.filter((f) => picked(f, picks, saved)));
  const zipTitle = $derived(
    saved && planned.files.every((f) => saved!.includes(f.kind) === picked(f, picks, saved))
      ? 'Your saved selection'
      : chosen.length === planned.files.length
        ? 'Every file from your chain'
        : chosen.length
          ? `${chosen.length} of ${planned.files.length} files picked`
          : 'No files picked',
  );
  async function exportNow(names: string[], remember: boolean) {
    // Saved as kinds, so it applies to the next episode, a guest's files and split parts too
    saved = remember ? [...new Set(planned.files.filter((f) => names.includes(f.name)).map((f) => f.kind))] : null;
    onsave(saved);
    picking = false;
    player.pause();
    playing = false;
    exporting = 'Preparing…';
    try {
      const exported = await onexport($state.snapshot(settings) as ExportSettings, names, (t) => (exporting = t));
      // Let the picker close and restore focus before announcing the result.
      await flush();
      completed = exported;
      measured = exported?.measured ?? null;
    } catch (err) {
      alert((err as Error).message);
    } finally {
      exporting = null;
    }
  }

  const toNext = (): void => {
    reached = Math.max(reached, step + 1);
    go(step + 1);
  };
  const pick = (): void => {
    picking = true;
  };
  const next: { label: string; onclick: () => void; disabled?: boolean; attrs?: Record<string, string> } = $derived(
    step < STEPS.length - 1
      ? { label: `Next: ${STEPS[step + 1].label}`, onclick: toNext }
      : completed
        ? { label: 'Back to sessions', onclick: () => location.assign(sessionsHref), attrs: { 'data-back-sessions': '' } as Record<string, string> }
        : { label: exporting ?? 'Export…', onclick: pick, disabled: !!exporting || waiting || info.demo, attrs: { 'data-export': '' } as Record<string, string> },
  );

  const card = 'flex flex-col rounded-[14px] bg-surface';
  const row = 'flex items-center gap-4 px-5 py-[18px]';
  const rule = 'mx-5 h-px bg-divider';
  const tag = 'font-mono text-[11px] font-medium tracking-[0.06em] text-text-3 uppercase';
</script>

<StepPage steps={STEPS} current={step} {reached} ongo={go} complete={!!completed}
  title={completed ? 'Your export is ready' : STEPS[step].title}
  lede={completed ? 'Your download has started.' : STEPS[step].lede}>
  {#if waiting}
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-warn/60 bg-warn/8 px-4 py-3.5" role="alert" data-guest-missing>
      <div class="min-w-0 flex-1">
        <div class="text-[14px]">{info.guestMissing!.name}'s track isn't here yet</div>
        <div class="mt-1 text-[13px] text-text-2">Export waits for it, so both tracks come out lined up with the same cuts.</div>
      </div>
      <a class="inline-flex h-9 items-center rounded-[10px] bg-text px-3.5 text-[14px] font-medium text-page hover:text-page" href={info.guestMissing!.href}>Get their track</a>
      <button
        type="button"
        class="text-[13px] text-text-2 underline-offset-2 hover:text-text hover:underline"
        data-guest-missing-skip
        onclick={() => confirm(`Export without ${info.guestMissing!.name}'s track? Their audio won't be in this zip.`) && (skipGuest = true)}>Export without them</button
      >
    </div>
  {/if}

  {#if id === 'edit'}
    <div class={card}>
      <div class={row}>
        <div class="min-w-0 flex-1">
          <div class="text-[14px]">Assembled edit</div>
          <div class="help mt-0.5">Keeps the last attempt of each line and cuts the rest. Saved as its own file; the raw WAV stays as it is. <span data-removes>{removes(settings)}</span></div>
        </div>
        <Switch name="assembled" label="Assembled edit" bind:checked={settings.assembled} />
      </div>
      <div class={rule}></div>
      <div class={row}>
        <div class="min-w-0 flex-1">
          <div class="text-[14px]">Marker tones in the full recording</div>
          <div class="help mt-0.5">
            A short beep at each <span data-tone-kinds>{info.toneKinds}</span>, ducked under your voice. The edit stays clean. Set up in
            <a href="/settings/recording" class="underline underline-offset-2 hover:text-text">Settings → Recording</a>.
          </div>
        </div>
        <Switch name="tones" label="Marker tones in the full recording" bind:checked={settings.tones} disabled={!info.tonesAvailable} />
      </div>
      {#if info.pads}
        <div class={rule}></div>
        <div class={row} data-pads-row>
          <div class="min-w-0 flex-1">
            <div class="text-[14px]">Pads track</div>
            <div class="help mt-0.5">{info.pads}</div>
          </div>
          <span class="rounded border border-border px-[7px] py-[3px] {tag} text-ok">Always</span>
        </div>
        <div class={rule}></div>
        <div class={row} data-mix-row>
          <div class="min-w-0 flex-1">
            <div class="text-[14px]">Rough mix</div>
            <div class="help mt-0.5">Mic and pads in one file, limited to <span class="font-mono text-[12px]">{M}1 dBFS</span>, for a quick listen.</div>
          </div>
          <Switch name="mix" label="Rough mix" bind:checked={settings.mix} />
        </div>
      {/if}
    </div>

    <div class="flex flex-col gap-3 transition-opacity" class:opacity-40={!settings.assembled} inert={!settings.assembled}>
      <h2 class="section-label">Pauses in the edit</h2>
      <div class="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5" role="radiogroup" aria-label="Pauses in the edit">
        {#each [['cut', 'Cut', 'Remove the paused stretch.'], ['keep', 'Keep', 'Leave it in, marked.'], ['split', 'Split', 'One file per segment between pauses.']] as [value, name, help]}
          <label class="flex cursor-pointer flex-col gap-1 rounded-[14px] border border-border px-4 py-3.5 hover:border-handle has-checked:border-handle has-checked:bg-control has-focus-visible:outline-2 has-focus-visible:outline-text">
            <input type="radio" name="pauses" {value} class="sr-only" bind:group={settings.pauses} />
            <span class="text-[14px]">{name}</span>
            <span class="text-[13px] leading-[1.45] text-text-2">{help}</span>
          </label>
        {/each}
      </div>
      <p class="text-[13px] text-text-3">Recording keeps running while paused, so markers stay lined up with the audio.</p>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <span class="help" data-counts>{info.counts}</span>
      <button type="button" class="h-9 rounded-[10px] border border-border px-3.5 text-[14px] hover:border-handle" data-open-markers onclick={onmarkers}>Open markers</button>
    </div>
  {:else if id === 'noise'}
    <div class="flex flex-wrap items-center gap-4 rounded-[14px] bg-surface px-5 py-[18px]" data-ns-room>
      <div class="min-w-[200px] flex-1">
        <div class="flex items-baseline gap-2">
          <span class="text-[14px]">Room noise</span>
          <span class="font-mono text-[13px] text-warn" data-ns-floor>{room == null ? '—' : `${minus(room.toFixed(0))} dBFS`}</span>
        </div>
        <div class="help mt-0.5 text-pretty">{roomText}</div>
      </div>
      {#if suggested > 0}
        <button type="button" class="h-9 rounded-[10px] border border-border px-3.5 text-[14px] hover:border-handle" data-ns-use onclick={() => (settings.ns = suggested)}>Use {suggested} %</button>
      {/if}
    </div>

    <div class="flex flex-col gap-3.5 rounded-[14px] bg-surface p-5">
      <label class="flex items-baseline justify-between" for="ns-amount"><span class="text-[14px]">Suppression</span><span class="font-mono text-[13px]" data-ns-value>{settings.ns ? `${settings.ns} %` : 'Off'}</span></label>
      <input id="ns-amount" name="ns" type="range" min="0" max="100" step="5" class="w-full" data-ns-amount bind:value={settings.ns} />
      <div class="flex justify-between font-mono text-[11px] text-text-3"><span>Off</span><span>Gentle</span><span>Strong</span></div>
      <div class="h-px bg-divider"></div>
      <div class="flex items-center gap-3">
        <span class="flex-none text-[13px] text-text-2">Background</span>
        <div class="relative h-1 flex-1 rounded-full bg-border"><div class="absolute inset-y-0 left-0 rounded-full bg-ok" style:width={`${Math.min(100, (reduction / 40) * 100)}%`}></div></div>
        <span class="flex-none font-mono text-[13px]" data-ns-reduction>{settings.ns ? `Background ${M}${reduction} dB` : 'No change'}</span>
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <h2 class="section-label">How to judge it</h2>
      <p class="text-[13px] leading-[1.6] text-pretty text-text-2">
        Play the preview below and switch to <span class="text-text">Removed</span> to hear only what’s being taken out. Hiss and hum there is right. If you hear words or the ends of breaths, turn it down.
      </p>
    </div>
    <p class="text-[13px] leading-normal text-text-3">
      The zip keeps the unprocessed WAV and edit too, plus cleaned copies ending in <span class="font-mono text-[12px]">_clean</span>. Noise suppression by
      <a href="https://github.com/Rikorose/DeepFilterNet" target="_blank" rel="noopener" class="underline-offset-2 hover:text-text hover:underline">DeepFilterNet3</a>
      · <a href="/settings/about" class="underline-offset-2 hover:text-text hover:underline">Credits</a>
    </p>
  {:else if id === 'tone'}
    <ToneStep bind:this={toneStep} {voices} bind:tones={settings.voices} {rate} {spectrum} onchange={() => {}} />
  {:else if id === 'loud'}
    <div class="flex flex-col gap-3.5 rounded-[14px] bg-surface p-5">
      <div class="flex items-baseline justify-between"><span class="text-[14px]">Target</span><span class="font-mono text-[13px]" data-pub-target>{TARGET_TEXT[settings.loudness]}</span></div>
      <Segmented
        name="pub-loudness"
        label="Target"
        value={settings.loudness}
        onchange={(v) => (settings.loudness = v as Loudness)}
        options={[
          { value: 'stereo', label: 'Stereo' },
          { value: 'mono', label: 'Mono' },
          { value: 'off', label: 'Off' },
        ]}
      />
      <p class="help">The usual podcast targets. True peaks stay under <span class="font-mono text-[12px] whitespace-nowrap">{M}1 dBTP</span> so encoding doesn’t clip. Off only limits the peaks.</p>
      {#if info.pads && settings.loudness === 'mono'}
        <p class="help" data-pub-mono-note>Your pads are stereo. Mono sums left and right into one channel, at the same balance you hear in stereo.</p>
      {/if}
    </div>
    <div class="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5" data-loud-readouts>
      {#each readouts as r}
        <div class="flex flex-col gap-1.5 rounded-[14px] bg-surface p-4">
          <span class={tag}>{r.k}</span>
          <span class="font-mono text-[22px]" data-loud={r.k}>{r.v} <span class="text-[12px] text-text-3">{r.u}</span></span>
        </div>
      {/each}
    </div>
    {#if info.meter}
      <div class="flex flex-col gap-3 rounded-[14px] bg-surface p-5" data-loudness>
        <ul class="flex flex-wrap items-center gap-4 text-[12px] text-text-2">
          <li class="flex items-center gap-2"><span class="h-0.5 w-4 rounded-full bg-text"></span>Target</li>
          <li class="flex items-center gap-2"><span class="h-2 w-4 rounded-sm bg-[color-mix(in_oklab,var(--color-ok)_45%,transparent)]"></span>Within <span class="font-mono whitespace-nowrap">1 LU</span></li>
          <li class="flex items-center gap-2"><span class="h-0.5 w-4 rounded-full bg-text-2"></span>Short-term loudness, levelled</li>
        </ul>
        <LoudnessGraph history={loud?.after.meter?.short ?? []} seconds={loud?.after.seconds ?? 0} target={targetOf(settings.loudness)} now={playing ? pos : null} />
      </div>
    {/if}
    <div class="{row} rounded-[14px] bg-surface">
      <div class="min-w-0 flex-1">
        <div class="text-[14px]">Level each speaker</div>
        <div class="help mt-0.5">Evens out each voice by up to <span class="font-mono text-[12px]">12 dB</span> before the episode is set to target. Adds a levelled copy of each person’s edit.</div>
      </div>
      <Switch name="pub-level" label="Level each speaker" bind:checked={settings.level} />
    </div>
  {:else}
    {#if completed}
      <div class="flex flex-col gap-4 rounded-[14px] bg-surface p-5" data-export-complete>
        <div class="flex items-center gap-3">
          <span class="flex size-8 flex-none items-center justify-center rounded-full bg-ok/10 text-ok" aria-hidden="true">✓</span>
          <div class="min-w-0">
            <p class="font-mono text-[13px]" data-export-result>{completed.files} {completed.files === 1 ? 'file' : 'files'} · {formatSize(completed.bytes)}</p>
            <p class="help mt-1 break-all">{completed.filename}</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" class="h-11 rounded-[10px] border border-border px-3.5 text-[14px] hover:border-handle sm:h-9" data-download-again onclick={completed.downloadAgain}>Download again</button>
          <button type="button" class="min-h-11 text-[13px] text-text-2 underline-offset-2 hover:text-text hover:underline sm:min-h-9" data-adjust-export onclick={() => go(step)}>Adjust export settings</button>
        </div>
      </div>
    {:else}
    <div class="flex flex-col gap-3">
      <h2 class="section-label">Your chain</h2>
      <div class={card} data-chain-summary>
        {#each summary as s, i}
          <div class="flex items-center gap-3 px-5 py-3.5" class:border-t={i > 0} class:border-divider={i > 0}>
            <span class="w-[18px] flex-none font-mono text-[11px] text-text-3">{String(i + 1).padStart(2, '0')}</span>
            <span class="w-[90px] flex-none text-[14px]">{s.label}</span>
            <span class="min-w-0 flex-1 truncate text-[13px] text-text-2">{s.value}</span>
            <button type="button" class="flex-none py-1.5 text-[13px] text-text-2 hover:text-text" data-change={STEPS[i].id} onclick={() => go(i)}>Change</button>
          </div>
        {/each}
      </div>
    </div>

    {/if}

    {#if measured}
      <div class="flex flex-col gap-3" data-measured>
        <h2 class="section-label">What the episode measured{measured.parts > 1 ? ' (part 1)' : ''}</h2>
        <div class="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5">
          {#each [{ k: 'Integrated', v: fmt(measured.integrated), u: 'LUFS' }, { k: 'Range', v: fmt(measured.range), u: 'LU' }, { k: 'True peak', v: fmt(measured.peak), u: 'dBTP' }] as r}
            <div class="flex flex-col gap-1.5 rounded-[14px] bg-surface p-4">
              <span class={tag}>{r.k}</span>
              <span class="font-mono text-[22px]" data-measured-value={r.k}>{r.v} <span class="text-[12px] text-text-3">{r.u}</span></span>
            </div>
          {/each}
        </div>
        {#if info.meter}
          <div class="rounded-[14px] bg-surface p-5"><LoudnessGraph history={measured.history} seconds={measured.seconds} target={targetOf(settings.loudness)} /></div>
        {/if}
      </div>
    {/if}

    {#if !completed}
    <div class="flex flex-col gap-3">
      <h2 class="section-label">In the zip</h2>
      <div class="flex flex-wrap items-center gap-4 rounded-[14px] bg-surface px-5 py-[18px]" data-zip>
        <div class="min-w-0 flex-1">
          <div class="text-[14px]" data-zip-title>{zipTitle}</div>
          <div class="mt-0.5 font-mono text-[12px] text-text-2" data-summary>{chosen.length} of {planned.files.length} · {formatSize(chosen.reduce((n, f) => n + f.bytes, 0))}</div>
        </div>
        <button type="button" class="h-9 rounded-[10px] border border-border px-3.5 text-[14px] hover:border-handle" data-choose-files onclick={() => (picking = true)}>Choose files</button>
      </div>
    </div>
    {/if}
    <p class="help" data-sync-note>Every WAV carries Broadcast WAV timecode, so editors can line the files up.{info.sync ? ` ${info.sync}` : ''}</p>
  {/if}

  <ExportPicker bind:open={picking} files={planned.files} bind:picks {saved} notes={planned.notes} ondownload={exportNow} onforget={() => ((saved = null), onsave(null))} />

  {#snippet player()}
    <StepPlayer
      summary={completed ? { text: 'Export ready', meta: `${completed.files} ${completed.files === 1 ? 'file' : 'files'} · ${formatSize(completed.bytes)}` } : null}
      options={AB[id]}
      {choice}
      onchoose={choose}
      chain={chainText}
      time={`${mmss(pos)} / ${mmss(dur || 30)}`}
      progress={dur ? pos / dur : 0}
      {playing}
      canPlay={!info.demo && !exporting}
      onplay={toggle}
      onback={step > 0 && !exporting && !completed ? () => go(step - 1) : null}
      {next}
    />
  {/snippet}
</StepPage>
