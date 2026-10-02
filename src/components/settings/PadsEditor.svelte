<script lang="ts">
  import { onMount } from 'svelte';
  import Sheet from '@/components/ui/Sheet.svelte';
  import Segmented from '@/components/ui/Segmented.svelte';
  import { Checkbox } from '@/components/shadcn/checkbox';
  import StatusDot from '@/components/ui/StatusDot.svelte';
  import { PadEngine } from '@/lib/audio/pad-engine';
  import { getTake, listTakes, readFrames, saveRemoteTake, type TakeMeta } from '@/lib/audio/takes';
  import { fetchTakeSegment, serverTakes } from '@/lib/take-upload';
  import { pullEpisode } from '@/lib/sync';
  import {
    KIND_DEFAULTS, LIBRARY_RATE, PAD_COLORS, decodeToLibraryRate, interleave, listLibrary,
    loadEpisodePads, loadPadSettings, loadShowPads, newPad, padColor, padInk, padTag, readLibraryFile,
    saveEpisodePads, saveLibraryFile, savePadSettings, saveShowPads, setPad, swapKeys,
    type LibraryFile, type Pad, type PadKind, type PadSet, type PadSettings,
  } from '@/lib/pads';

  interface Bite { s: string; e: string; title: string }
  interface Props { episodeId: string; episodeLabel: string; bites: Bite[] }
  let { episodeId, episodeLabel, bites }: Props = $props();

  let layer = $state<'show' | 'episode'>('show');
  let key = $state(Math.max(1, Math.min(9, Number(new URL(location.href).searchParams.get('key')) || 1)));
  let open = $state(false), dirty = $state(false), busy = $state(false), previewing = $state(false);
  let draft = $state<Pad | null>(null), message = $state('');
  // These are snapshots of the current route's immutable episode prop.
  // svelte-ignore state_referenced_locally
  let showPads = $state<PadSet>(loadShowPads()), episodePads = $state<PadSet>(loadEpisodePads(episodeId));
  let audioVersion = $state(0);
  let padSettings = $state<PadSettings>(loadPadSettings());
  let library = $state<LibraryFile[]>([]);
  let sessions = $state<{ meta: TakeMeta; server: boolean; segments: number }[]>([]);
  let clipTake = $state(''), clipFrom = $state('0:00'), clipTo = $state('0:10');
  let waveform: HTMLCanvasElement;
  const audio = new Map<string, Float32Array>();
  let preview: PadEngine | null = null, previewTimer = 0;

  const input = 'h-10 w-full rounded-[10px] border border-border bg-page px-3 text-[14px] text-text focus:border-handle focus:outline-none';
  const setOf = (which = layer): PadSet => which === 'show' ? showPads : episodePads;
  const ownPads = $derived(layer === 'show' ? showPads : episodePads);
  const inherited = $derived(layer === 'episode' ? showPads : []);
  const minSec = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  const parseTime = (v: string) => { const p = v.trim().split(':').map(Number); return p.some((n) => !Number.isFinite(n)) ? NaN : p.reduce((t, n) => t * 60 + n, 0); };

  onMount(() => {
    void (async () => {
      await pullEpisode(episodeId); showPads = loadShowPads(); episodePads = loadEpisodePads(episodeId);
      await Promise.all([fillLibrary(), fillSessions()]);
      if (new URL(location.href).searchParams.has('key')) edit(key);
    })();
    const before = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    addEventListener('beforeunload', before);
    return () => { stopPreview(); removeEventListener('beforeunload', before); };
  });

  const padAt = (k: number) => ownPads.find((p) => p.key === k) ?? inherited.find((p) => p.key === k);
  const isInherited = (k: number) => layer === 'episode' && !ownPads.some((p) => p.key === k) && inherited.some((p) => p.key === k);
  function edit(k: number) {
    stopPreview(); key = k;
    const own = setOf().find((p) => p.key === k);
    const from = layer === 'episode' ? loadShowPads().find((p) => p.key === k) : undefined;
    draft = own ? { ...own } : from ? { ...from, id: newPad(k, from.kind, { id: '', seconds: 0, name: '' }).id } : null;
    dirty = false; message = ''; open = true;
    if (draft) { ensureAudio(draft.fileId); requestAnimationFrame(drawWave); }
  }
  function close() { stopPreview(); draft = null; dirty = false; message = ''; }
  function change(patch: Partial<Pad>) { if (draft) { draft = { ...draft, ...patch }; dirty = true; message = ''; drawWave(); } }
  function chooseKind(kind: PadKind) {
    if (draft) change({ kind, ...KIND_DEFAULTS[kind] });
    else { draft = newPad(key, kind, { id: '', name: '', seconds: 0 }); dirty = true; }
  }
  function useFile(file: Pick<LibraryFile, 'id' | 'seconds' | 'name' | 'source'>, kind: PadKind) {
    stopPreview();
    if (draft) change({ fileId: file.id, seconds: file.seconds, source: file.source, name: draft.name || file.name, trimStart: 0, trimEnd: 0, kind, ...(draft.kind !== kind ? KIND_DEFAULTS[kind] : {}) });
    else { draft = newPad(key, kind, file); dirty = true; }
    ensureAudio(file.id);
  }
  async function saveSet(set: PadSet, which = layer) {
    if (which === 'show') { showPads = set; await saveShowPads(set); }
    else { episodePads = set; await saveEpisodePads(episodeId, set); }
  }
  async function savePad() {
    if (!draft || busy) return;
    busy = true; message = 'Saving…';
    try { await saveSet(setPad(setOf(), key, { ...draft, name: draft.name.trim() || `Pad ${key}` })); dirty = false; open = false; close(); }
    catch (error) { message = (error as Error).message || 'Couldn’t save this pad.'; }
    finally { busy = false; }
  }
  async function clearPad() {
    if (!setOf().some((p) => p.key === key) || !confirm(layer === 'episode' ? 'Remove this episode’s pad? The show set’s pad comes back.' : 'Clear this pad? Its sound stays in the library.')) return;
    busy = true; await saveSet(setPad(setOf(), key, null)); busy = false; open = false; close();
  }
  async function swap(from: number, to: number) { if (from && from !== to) await saveSet(swapKeys(setOf(), from, to)); }

  async function fillLibrary() { library = await listLibrary().catch(() => []); }
  async function fillSessions() {
    const local = (await listTakes().catch(() => [])).filter((t) => t.kind === 'session' && t.status === 'done');
    const remote = (await serverTakes()).filter((t) => t.done && t.meta.kind === 'session');
    const all = new Map<string, { meta: TakeMeta; server: boolean; segments: number }>();
    for (const t of remote) all.set(t.id, { meta: { ...t.meta, segments: t.segments }, server: true, segments: t.segments });
    for (const t of local) all.set(t.id, { meta: t, server: false, segments: t.segments });
    sessions = [...all.values()].sort((a, b) => b.meta.startedAt - a.meta.startedAt);
    clipTake ||= sessions[0]?.meta.id ?? '';
  }
  async function localTake(choice: { meta: TakeMeta; server: boolean; segments: number }) {
    const found = await getTake(choice.meta.id); if (found) return found;
    message = `Bringing in 0 of ${choice.segments} pieces…`;
    return saveRemoteTake({ ...choice.meta, segments: choice.segments, status: 'done', remote: true }, (n) => fetchTakeSegment(choice.meta.id, n), (n) => (message = `Bringing in ${n} of ${choice.segments} pieces…`));
  }
  async function cutClip(kind: PadKind, from: number, to: number, name: string, source: string) {
    const choice = sessions.find((s) => s.meta.id === clipTake) ?? sessions.find((s) => s.meta.episodeId === episodeId);
    if (!choice || !(to > from)) return (message = 'Pick a session and a start and end, like 1:20 – 1:32.');
    busy = true;
    try {
      const take = await localTake(choice), len = take.samples / take.sampleRate;
      if (!(from < len)) throw new Error(`That session is only ${minSec(len)} long.`);
      message = 'Cutting clip…';
      const start = Math.floor(from * take.sampleRate), frames = Math.floor((Math.min(to, len) - from) * take.sampleRate);
      const x = await readFrames(take, start, frames), channels = take.channels ?? 1;
      const left = new Float32Array(frames), right = new Float32Array(frames);
      for (let i = 0; i < frames; i++) { left[i] = x[i * channels]; right[i] = x[i * channels + (channels > 1 ? 1 : 0)]; }
      let stereo = interleave(left, right);
      if (take.sampleRate !== LIBRARY_RATE) {
        const ctx = new OfflineAudioContext(2, Math.ceil((frames / take.sampleRate) * LIBRARY_RATE), LIBRARY_RATE);
        const buf = ctx.createBuffer(2, frames, take.sampleRate); buf.copyToChannel(left, 0); buf.copyToChannel(right, 1);
        const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
        const rendered = await ctx.startRendering(); stereo = interleave(rendered.getChannelData(0), rendered.getChannelData(1));
      }
      const saved = await saveLibraryFile(stereo, { name, source }); audio.set(saved.id, stereo); useFile(saved, kind); await fillLibrary(); message = '';
    } catch (error) { message = (error as Error).message || 'Couldn’t make that clip.'; }
    finally { busy = false; }
  }
  async function upload(event: Event, kind: PadKind) {
    const el = event.currentTarget as HTMLInputElement, file = el.files?.[0]; if (!file) return;
    busy = true; message = `Converting ${file.name}…`;
    try {
      const stereo = await decodeToLibraryRate(await file.arrayBuffer()); message = `Uploading ${file.name}…`;
      const saved = await saveLibraryFile(stereo, { name: file.name.replace(/\.[^.]+$/, ''), source: `Upload · ${file.name}` });
      audio.set(saved.id, stereo); useFile(saved, kind); await fillLibrary(); message = '';
    } catch (error) { message = `Couldn’t add ${file.name}: ${(error as Error).message}`; }
    finally { busy = false; el.value = ''; }
  }

  async function ensureAudio(id: string) {
    if (!id || audio.has(id)) return;
    try { audio.set(id, await readLibraryFile(id)); audioVersion++; drawWave(); }
    catch { message = 'This sound is not available. Choose or upload it again.'; }
  }
  function drawWave() {
    audioVersion; if (!waveform) return;
    const width = waveform.width = waveform.clientWidth * devicePixelRatio || 600, height = waveform.height = 64 * devicePixelRatio;
    const g = waveform.getContext('2d')!; g.clearRect(0, 0, width, height);
    const x = draft && audio.get(draft.fileId); if (!draft || !x) return;
    const frames = x.length / 2, a = (draft.trimStart / draft.seconds) * width, b = ((draft.trimEnd || draft.seconds) / draft.seconds) * width;
    const step = Math.max(1, Math.floor(frames / width)); g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(`--pad-${draft.color}`) || '#ededea';
    for (let px = 0; px < width; px++) { let peak = 0; for (let i = px * step; i < Math.min(frames, (px + 1) * step); i += 4) peak = Math.max(peak, Math.abs(x[2 * i]), Math.abs(x[2 * i + 1])); g.globalAlpha = px >= a && px <= b ? 1 : 0.25; const bar = Math.max(devicePixelRatio, peak * height); g.fillRect(px, (height - bar) / 2, devicePixelRatio, bar); }
  }
  function stopPreview() { clearTimeout(previewTimer); preview?.stopAll(); preview?.ctx?.close().catch(() => {}); preview = null; previewing = false; }
  async function togglePreview() {
    if (previewing) return stopPreview(); if (!draft) return;
    preview = new PadEngine({ ...loadPadSettings(), volumeDb: 0 }); await preview.load([{ ...draft, key: 1 }]);
    if (!preview.playable(1)) return (message = 'This sound is not available to preview.');
    preview.press(1); previewing = true;
    const seconds = draft.mode === 'oneshot' ? Math.max(0.3, Math.min(30, (draft.trimEnd || draft.seconds) - draft.trimStart)) : 4;
    previewTimer = window.setTimeout(() => { if (draft?.mode === 'hold') preview?.release(1); else preview?.fadeAll(draft?.fadeOutMs ? draft.fadeOutMs / 1000 : 0.05); previewing = false; }, seconds * 1000);
  }
  function saveGlobal(field: keyof PadSettings, value: number) { padSettings = { ...padSettings, [field]: value }; savePadSettings({ [field]: value }); }
</script>

<div class="flex flex-col gap-10" data-pads-editor>
  <section class="flex flex-col gap-3">
    <h2 class="section-label">Pads</h2>
    <Segmented label="Which set" value={layer} options={[{ value: 'show', label: 'Show set' }, { value: 'episode', label: `${episodeLabel} only` }]} onchange={(v) => (layer = v as typeof layer)} data-layer-picker />
    <div class="grid grid-cols-3 gap-2 sm:max-w-[420px]" data-grid>
      {#each Array.from({ length: 9 }, (_, i) => i + 1) as k}
        {@const pad = padAt(k)}
        <button
          type="button"
          class="relative flex aspect-[1.05] min-w-0 flex-col justify-between overflow-hidden rounded-[12px] p-2.5 text-left {pad ? '' : 'border border-dashed border-track-off text-text-3 hover:border-handle'}"
          style:background={pad ? padColor(pad.color) : undefined}
          style:color={pad ? padInk(pad.color) : undefined}
          style:opacity={isInherited(k) ? 0.4 : 1}
          data-grid-key={k}
          draggable={!!ownPads.find((p) => p.key === k)}
          ondragstart={(e) => e.dataTransfer?.setData('text/plain', String(k))}
          ondragover={(e) => e.preventDefault()}
          ondrop={(e) => (e.preventDefault(), swap(Number(e.dataTransfer?.getData('text/plain')), k))}
          onclick={() => edit(k)}
        >
          <span class="flex justify-between"><span class="font-mono text-[18px] leading-none font-medium">{k}</span>{#if pad}<span class="font-mono text-[9px] opacity-70">{padTag(pad)}</span>{/if}</span>
          <span class="line-clamp-2 text-[13px] leading-tight font-semibold">{pad?.name ?? 'Empty · click to assign'}</span>
          {#if layer === 'episode' && ownPads.find((p) => p.key === k)}<StatusDot color="rgba(0,0,0,.6)" size={6} class="absolute top-1.5 left-1/2 -translate-x-1/2" />{/if}
        </button>
      {/each}
    </div>
    <p class="help">Drag to swap keys. The show set is used for every episode, and an episode can override one pad without changing the set.</p>
  </section>

  <section class="flex flex-col gap-3">
    <h2 class="section-label">Ducking, for every pad that ducks</h2>
    <div class="grid gap-3 rounded-[14px] bg-surface p-5 sm:grid-cols-3">
      <label class="flex flex-col gap-2 text-[14px]">Attack <span class="font-mono text-[12px] text-text-3">ms</span><input class={input} type="number" min="1" max="1000" value={padSettings.duckAttackMs} onchange={(e) => saveGlobal('duckAttackMs', Number(e.currentTarget.value))} data-g="duckAttackMs" /></label>
      <label class="flex flex-col gap-2 text-[14px]">Release <span class="font-mono text-[12px] text-text-3">ms</span><input class={input} type="number" min="10" max="5000" value={padSettings.duckReleaseMs} onchange={(e) => saveGlobal('duckReleaseMs', Number(e.currentTarget.value))} data-g="duckReleaseMs" /></label>
      <label class="flex flex-col gap-2 text-[14px]">Voice above <span class="font-mono text-[12px] text-text-3">dBFS</span><input class={input} type="number" min="-70" max="-10" value={padSettings.threshold} onchange={(e) => saveGlobal('threshold', Number(e.currentTarget.value))} data-g="threshold" /></label>
      <p class="help sm:col-span-3">Attack is how fast the pads drop when you start talking; release is how fast they come back.</p>
    </div>
  </section>
</div>

<Sheet bind:open labelledby="pad-sheet-title" onclose={close} data-pad-editor-sheet>
  {#snippet header()}
    <h2 id="pad-sheet-title" class="text-[18px] font-medium">Set up pad {key}</h2>
    <p class="mt-1 font-mono text-[12px] text-text-2">{layer === 'show' ? 'SHOW SET' : episodeLabel.toUpperCase()}</p>
  {/snippet}

  <div class="flex flex-col gap-5" data-pad-detail>
    <div class="flex items-start gap-3">
      <span class="flex size-11 flex-none items-center justify-center rounded-[12px] font-mono text-[19px] font-medium" style:background={draft ? padColor(draft.color) : 'var(--color-control)'} style:color={draft ? padInk(draft.color) : undefined}>{key}</span>
      <div class="min-w-0 flex-1">
        <input class="w-full bg-transparent text-[18px] focus:outline-none disabled:text-text-3" aria-label="Pad name" placeholder="Choose a sound first" value={draft?.name ?? ''} disabled={!draft} oninput={(e) => change({ name: e.currentTarget.value })} data-d-name />
        <p class="mt-0.5 truncate text-[13px] text-text-2" data-d-source>{draft ? `${draft.source ?? 'Library'} · ${minSec(draft.seconds)} · 48 kHz` : 'No sound yet'}</p>
      </div>
      <button type="button" class="h-9 rounded-[10px] border border-border px-3 text-[14px] disabled:opacity-40" disabled={!draft?.fileId || busy} onclick={togglePreview} data-d-preview>{previewing ? 'Stop' : 'Preview'}</button>
    </div>
    <canvas bind:this={waveform} class="h-16 w-full rounded-[10px] bg-page" aria-label="Sound waveform" data-d-wave></canvas>

    <div class="flex flex-col gap-2">
      <span class="text-[14px]">Sound</span>
      <Segmented label="Sound kind" value={draft?.kind ?? null} options={[{ value: 'bite', label: 'Soundbite', shortLabel: 'Bite' }, { value: 'clip', label: 'Clip' }, { value: 'music', label: 'Music' }, { value: 'sfx', label: 'Sound effect', shortLabel: 'SFX' }]} onchange={(v) => chooseKind(v as PadKind)} data-kind-picker />
      {#if draft?.kind === 'bite'}
        <select class={input} aria-label="Soundbite" onchange={(e) => { const b = bites[Number(e.currentTarget.value)]; if (b) { clipTake = sessions.find((s) => s.meta.episodeId === episodeId)?.meta.id ?? clipTake; cutClip('bite', parseTime(b.s), parseTime(b.e), `${b.title.split(/\s+/).slice(0, 4).join(' ')}…`, `Soundbite from ${episodeLabel}`); } e.currentTarget.value = ''; }} data-bite>
          <option value="">Pick a soundbite…</option>{#each bites as b, i}<option value={i}>{b.s.replace(/^00:/, '')} · {b.title}</option>{/each}
        </select>
      {/if}
      {#if draft?.kind === 'clip'}
        <div class="flex flex-col gap-2" data-clip-source>
          <select class={input} aria-label="Previous session" bind:value={clipTake} data-clip-take>
            {#if sessions.length}{#each sessions as s}<option value={s.meta.id}>Ep. {s.meta.episodeId} · {s.meta.name} · {minSec(s.meta.samples / s.meta.sampleRate)}{s.server ? ' · server' : ''}</option>{/each}{:else}<option value="">No completed sessions</option>{/if}
          </select>
          <div class="flex items-center gap-2">
            <input class={input} aria-label="Clip start" bind:value={clipFrom} data-clip-from /><span class="text-text-3">–</span><input class={input} aria-label="Clip end" bind:value={clipTo} data-clip-to />
            <button type="button" class="h-10 flex-none rounded-[10px] bg-control px-3 text-[14px] disabled:opacity-40" disabled={busy || !clipTake} onclick={() => cutClip('clip', parseTime(clipFrom), parseTime(clipTo), `Clip ${clipFrom}`, `Clip from a previous episode · ${clipFrom}–${clipTo}`)} data-clip-use>Use range</button>
          </div>
          <label class="flex h-10 cursor-pointer items-center justify-center rounded-[10px] border border-border text-[14px] hover:border-handle">Upload your own clip<input type="file" accept=".wav,.mp3,.m4a,.flac,audio/*" class="sr-only" onchange={(e) => upload(e, 'clip')} data-clip-upload /></label>
        </div>
      {/if}
      {#if draft?.kind === 'music' || draft?.kind === 'sfx'}
        <div class="flex flex-col gap-2" data-upload-source>
          <label class="flex h-10 cursor-pointer items-center justify-center rounded-[10px] border border-border text-[14px] hover:border-handle">Upload a file<input type="file" accept=".wav,.mp3,.m4a,.flac,audio/*" class="sr-only" onchange={(e) => upload(e, draft?.kind === 'sfx' ? 'sfx' : 'music')} data-upload /></label>
          <select class={input} aria-label="From the library" onchange={(e) => { const file = library.find((x) => x.id === e.currentTarget.value); if (file) useFile(file, draft?.kind === 'sfx' ? 'sfx' : 'music'); e.currentTarget.value = ''; }} data-library><option value="">{library.length ? 'Or pick from the library…' : 'The library is empty'}</option>{#each library as file}<option value={file.id}>{file.name} · {minSec(file.seconds)}</option>{/each}</select>
        </div>
      {/if}
    </div>

    <div class="flex flex-col gap-2"><span class="text-[14px]">Color</span><div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Pad color" data-colors>{#each PAD_COLORS as color}<button type="button" role="radio" aria-label={color} aria-checked={draft?.color === color} class="size-8 rounded-lg aria-checked:shadow-[0_0_0_2px_var(--color-sheet),0_0_0_4px_var(--color-text)] disabled:opacity-40" style:background={padColor(color)} disabled={!draft} onclick={() => change({ color })} data-color={color}></button>{/each}</div></div>
    <div class="flex flex-col gap-2"><span class="text-[14px]">When pressed</span><Segmented label="When pressed" value={draft?.mode ?? null} options={[{ value: 'oneshot', label: 'One-shot' }, { value: 'loop', label: 'Loop' }, { value: 'hold', label: 'Hold' }]} onchange={(v) => change({ mode: v as Pad['mode'] })} data-mode-picker /></div>
    <div class="grid gap-4 sm:grid-cols-2" class:opacity-40={!draft}>
      <label class="flex flex-col gap-2 text-[14px]">Volume <span class="font-mono text-[12px] text-text-3">{draft?.gainDb ?? 0} dB</span><input type="range" min="-24" max="6" step="1" value={draft?.gainDb ?? 0} disabled={!draft} oninput={(e) => change({ gainDb: Number(e.currentTarget.value) })} data-d-gain /></label>
      <label class="flex flex-col gap-2 text-[14px]">Fade in / out <span class="font-mono text-[12px] text-text-3">ms</span><span class="flex gap-2"><input class={input} type="number" min="0" max="10000" value={draft?.fadeInMs ?? 0} disabled={!draft} onchange={(e) => change({ fadeInMs: Number(e.currentTarget.value) })} data-d-fadein /><input class={input} type="number" min="0" max="10000" value={draft?.fadeOutMs ?? 0} disabled={!draft} onchange={(e) => change({ fadeOutMs: Number(e.currentTarget.value) })} data-d-fadeout /></span></label>
      <label class="flex flex-col gap-2 text-[14px]">Trim <span class="font-mono text-[12px] text-text-3">s</span><span class="flex gap-2"><input class={input} type="number" min="0" step="0.1" value={draft?.trimStart ?? 0} disabled={!draft} onchange={(e) => change({ trimStart: Number(e.currentTarget.value) })} data-d-trimstart /><input class={input} type="number" min="0" step="0.1" value={draft?.trimEnd || ''} placeholder="end" disabled={!draft} onchange={(e) => change({ trimEnd: Number(e.currentTarget.value || 0) })} data-d-trimend /></span></label>
      <div class="flex flex-col gap-2 text-[14px]">Duck under your voice <span class="flex h-10 items-center gap-2"><Checkbox id="pad-duck" checked={draft?.duck ?? false} disabled={!draft} onCheckedChange={(checked) => change({ duck: checked })} data-d-duck /><label for="pad-duck">On</label><input class="h-10 w-20 rounded-[10px] border border-border bg-page px-3 font-mono text-[13px]" type="number" min="1" max="40" value={draft?.duckDb ?? 12} disabled={!draft} onchange={(e) => change({ duckDb: Number(e.currentTarget.value) })} data-d-duckdb /><span class="font-mono text-[12px] text-text-3">dB</span></span></div>
    </div>
    {#if message}<p class="text-[13px] {message.startsWith('Couldn') || message.startsWith('This sound') ? 'text-rec' : 'text-text-2'}" role="status" data-pad-message>{message}</p>{/if}
  </div>

  {#snippet footer()}
    <div class="flex items-center gap-2">
      <button type="button" class="h-9 rounded-[10px] border border-rec/70 px-3 text-[14px] text-rec disabled:opacity-40" disabled={!setOf().some((p) => p.key === key) || busy} onclick={clearPad} data-d-clear>Clear pad</button>
      <span class="flex-1"></span>
      <button type="button" class="h-9 rounded-[10px] px-3 text-[14px] text-text-2 hover:text-text" onclick={() => (open = false)}>Cancel</button>
      <button type="button" class="h-9 rounded-[10px] bg-primary px-4 text-[14px] font-medium text-primary-fg disabled:opacity-40" disabled={!draft?.fileId || !dirty || busy} onclick={savePad} data-d-save>{busy ? 'Working…' : 'Save pad'}</button>
    </div>
  {/snippet}
</Sheet>
