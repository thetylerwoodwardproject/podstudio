<script lang="ts" module>
  import type { EditorProjectV1, EditorTrack } from '@/lib/editor-project';

  export type EditorSaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'failed' | 'conflict';
  export interface EditorPreview { url: string; duration: number }
  export interface EditorExportResult { filename: string; downloadAgain: () => void }
  export interface EditorConflict { project: EditorProjectV1; revision: number }
  export interface EditorTrackView { id: string; peaks: number[]; color: string }
  export interface EditorSaveResult { revision: number; conflict?: EditorConflict }
  export interface EditorProps {
    sessionsHref: string;
    initial: EditorProjectV1;
    revision: number;
    views: EditorTrackView[];
    onpreview: (project: EditorProjectV1, from: number, seconds: number, solo: string[]) => Promise<EditorPreview>;
    onsave: (project: EditorProjectV1, revision: number, force?: boolean) => Promise<EditorSaveResult>;
    onimport: (file: File, at: number) => Promise<{ track: EditorTrack; peaks: number[] }>;
    onexport: (project: EditorProjectV1, progress: (message: string) => void) => Promise<EditorExportResult>;
  }
</script>

<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import Sheet from '@/components/ui/Sheet.svelte';
  import {
    deleteRange,
    moveClip,
    projectDuration,
    splitProject,
    trimClip,
  } from '@/lib/editor-project';

  let { sessionsHref, initial, revision: initialRevision, views, onpreview, onsave, onimport, onexport }: EditorProps = $props();
  let project = $state(structuredClone(initial));
  let revision = $state(initialRevision);
  let saveState = $state<EditorSaveState>('idle');
  let saveMessage = $state('Saved');
  let conflict = $state<EditorConflict | null>(null);
  let history = $state<EditorProjectV1[]>([]);
  let future = $state<EditorProjectV1[]>([]);
  let selectedTrack = $state(project.tracks[0]?.id ?? '');
  let selectedClip = $state('');
  let selectionStart = $state(0);
  let selectionEnd = $state(0);
  let playhead = $state(0);
  let zoom = $state(1);
  let solo = $state<string[]>([]);
  let fxTrack = $state<EditorTrack | null>(null);
  let exportOpen = $state(false);
  let retakesOpen = $state(false);
  let pausesOpen = $state(false);
  let exporting = $state(false);
  let exportStatus = $state('');
  let completed = $state<EditorExportResult | null>(null);
  let importing = $state(false);
  let importError = $state('');
  let audio: HTMLAudioElement | null = null;
  let nextAudio: { at: number; element: HTMLAudioElement; url: string; duration: number } | null = null;
  let previewUrl = '';
  let playing = $state(false);
  let loadingAudio = $state(false);
  let timer = 0;
  let playTimer = 0;
  const HEADER = 176;
  const duration = $derived(projectDuration(project));
  const pxPerSecond = $derived(8 * zoom);
  const timelineWidth = $derived(Math.max(900, duration * pxPerSecond));
  const selection = $derived([Math.min(selectionStart, selectionEnd), Math.max(selectionStart, selectionEnd)] as [number, number]);
  const hasSelection = $derived(selection[1] - selection[0] > 0.01);
  const pendingRetakes = $derived(project.retakes.filter((r) => !r.reviewed).length);
  const plain = <T,>(value: T): T => structuredClone($state.snapshot(value) as T);

  const fmt = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
  };
  const label = (kind: string) => ({ retake: 'RET', cut: 'COUGH', adlib: 'AD-LIB', pause: 'PAUSE', gap: 'MIC' }[kind] ?? '');
  const viewFor = (id: string) => views.find((v) => v.id === id);

  function update(next: EditorProjectV1, record = true) {
    if (record) {
      history = [...history.slice(-99), plain(project)];
      future = [];
    }
    project = next;
    project.updatedAt = Date.now();
    queueSave();
    if (playing) void loadWindow(playhead, true);
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    future = [plain(project), ...future];
    history = history.slice(0, -1);
    project = previous;
    queueSave();
  }
  function redo() {
    const next = future[0];
    if (!next) return;
    history = [...history, plain(project)];
    future = future.slice(1);
    project = next;
    queueSave();
  }

  function queueSave() {
    localStorage.setItem(`podstudio-editor-${project.takeId}`, JSON.stringify(project));
    saveState = navigator.onLine ? 'saving' : 'offline';
    saveMessage = navigator.onLine ? 'Saving…' : 'Waiting for connection';
    clearTimeout(timer);
    timer = window.setTimeout(save, 650);
  }

  async function save(force = false) {
    if (!navigator.onLine) {
      saveState = 'offline'; saveMessage = 'Waiting for connection'; return;
    }
    saveState = 'saving'; saveMessage = 'Saving…';
    try {
      const result = await onsave($state.snapshot(project) as EditorProjectV1, revision, force);
      if (result.conflict) {
        conflict = result.conflict; saveState = 'conflict'; saveMessage = 'Project changed elsewhere'; return;
      }
      revision = result.revision;
      localStorage.removeItem(`podstudio-editor-${project.takeId}`);
      saveState = 'saved'; saveMessage = 'Saved';
    } catch (error) {
      saveState = navigator.onLine ? 'failed' : 'offline';
      saveMessage = navigator.onLine ? `Couldn’t save` : 'Waiting for connection';
    }
  }

  function reloadConflict() {
    if (!conflict) return;
    project = plain(conflict.project); revision = conflict.revision; conflict = null;
    history = []; future = []; saveState = 'saved'; saveMessage = 'Server version loaded';
  }
  async function overwriteConflict() {
    if (!conflict) return;
    revision = conflict.revision; conflict = null; await save(true);
  }

  function point(e: MouseEvent | PointerEvent, node: HTMLElement) {
    const rect = node.getBoundingClientRect();
    return Math.max(0, Math.min(duration, (e.clientX - rect.left) / pxPerSecond));
  }
  function beginSelection(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('[data-clip]')) return;
    const node = e.currentTarget as HTMLElement;
    selectionStart = point(e, node); selectionEnd = selectionStart; playhead = selectionStart;
    node.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => selectionEnd = point(ev, node);
    const up = () => { node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up); };
    node.addEventListener('pointermove', move); node.addEventListener('pointerup', up);
  }

  function dragClip(e: PointerEvent, track: EditorTrack, clipId: string) {
    const target = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const clip = track.clips.find((c) => c.id === clipId)!;
    const original = clip.timelineStart;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const draft = moveClip(project, track.id, clipId, Math.max(0, original + (ev.clientX - startX) / pxPerSecond), ev.altKey);
      project = draft;
    };
    const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); history = [...history.slice(-99), originalProject]; future = []; queueSave(); };
    const originalProject = plain(project);
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', up);
  }

  function trim(e: PointerEvent, track: EditorTrack, clipId: string, edge: 'start' | 'end') {
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const original = plain(project);
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => project = trimClip(original, track.id, clipId, edge, Math.abs(ev.clientX - startX) / pxPerSecond);
    const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); history = [...history.slice(-99), original]; future = []; queueSave(); };
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', up);
  }

  function remove(ripple: boolean) {
    if (!hasSelection) return;
    update(deleteRange(project, selection[0], selection[1], ripple, selectedTrack || undefined));
    playhead = selection[0]; selectionStart = selectionEnd = playhead;
  }
  function split() { update(splitProject(project, playhead, selectedTrack || undefined)); }
  function unlinkSelected() {
    if (!selectedClip) return;
    const next = plain(project);
    const clip = next.tracks.find((t) => t.id === selectedTrack)?.clips.find((c) => c.id === selectedClip);
    if (clip) clip.linked = !clip.linked;
    update(next);
  }

  function toggleMute(id: string) {
    const next = plain(project); const track = next.tracks.find((t) => t.id === id);
    if (track) track.muted = !track.muted;
    update(next);
  }
  function toggleSolo(id: string) { solo = solo.includes(id) ? solo.filter((x) => x !== id) : [...solo, id]; if (playing) void loadWindow(playhead, true); }
  function level(id: string, gainDb: number) {
    const next = plain(project); const track = next.tracks.find((t) => t.id === id);
    if (track) track.gainDb = gainDb;
    update(next);
  }

  async function loadWindow(at: number, autoplay: boolean, windowSeconds = 30, loop = false) {
    const token = ++playTimer;
    loadingAudio = true;
    try {
      const result = await onpreview($state.snapshot(project) as EditorProjectV1, at, windowSeconds, $state.snapshot(solo));
      if (token !== playTimer) { URL.revokeObjectURL(result.url); return; }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (nextAudio) { URL.revokeObjectURL(nextAudio.url); nextAudio = null; }
      previewUrl = result.url;
      audio?.pause();
      audio = new Audio(result.url);
      audio.loop = loop;
      wireAudio(audio, at, result.duration);
      if (autoplay) { await audio.play(); playing = true; }
    } catch (error) {
      saveMessage = `Preview failed: ${(error as Error).message}`;
    } finally { if (token === playTimer) loadingAudio = false; }
  }
  async function previewJoin(at: number) { await loadWindow(Math.max(0, at - 2), true, 4, true); }
  function wireAudio(element: HTMLAudioElement, at: number, seconds: number) {
    element.onended = () => {
      playhead = Math.min(duration, at + seconds);
      if (nextAudio && Math.abs(nextAudio.at - playhead) < .1) {
        URL.revokeObjectURL(previewUrl); previewUrl = nextAudio.url; audio = nextAudio.element; const nextAt = nextAudio.at; const nextSeconds = nextAudio.duration; nextAudio = null;
        wireAudio(audio, nextAt, nextSeconds); void audio.play();
      } else if (playhead < duration - .01) void loadWindow(playhead, true);
      else playing = false;
    };
    element.ontimeupdate = () => {
      playhead = Math.min(duration, at + element.currentTime);
      if (!nextAudio && seconds > 20 && element.currentTime > seconds - 8 && at + seconds < duration) void prefetch(at + seconds);
    };
  }
  async function prefetch(at: number) {
    try {
      const result = await onpreview($state.snapshot(project) as EditorProjectV1, at, 30, $state.snapshot(solo));
      if (nextAudio) URL.revokeObjectURL(nextAudio.url);
      const element = new Audio(result.url); element.preload = 'auto'; element.load();
      nextAudio = { at, element, url: result.url, duration: result.duration };
    } catch {}
  }
  async function play() {
    if (audio && previewUrl && audio.paused && audio.currentTime < audio.duration - .05) { await audio.play(); playing = true; return; }
    await loadWindow(playhead, true);
  }
  function pause() { audio?.pause(); playing = false; }
  function stop() { audio?.pause(); audio = null; playing = false; playhead = 0; }
  function seek(at: number) { audio?.pause(); audio = null; playing = false; playhead = Math.max(0, Math.min(duration, at)); }

  async function importFile(file: File | undefined) {
    if (!file) return;
    importing = true; importError = '';
    try {
      const result = await onimport(file, playhead);
      views = [...views, { id: result.track.id, peaks: result.peaks, color: 'var(--color-adlib)' }];
      update({ ...plain(project), tracks: [...plain(project.tracks), result.track] });
      selectedTrack = result.track.id;
    } catch (error) { importError = (error as Error).message; }
    finally { importing = false; }
  }

  async function runExport() {
    if (pendingRetakes) { exportStatus = `Review ${pendingRetakes} retake ${pendingRetakes === 1 ? 'group' : 'groups'} first.`; return; }
    exporting = true; completed = null;
    try { completed = await onexport($state.snapshot(project) as EditorProjectV1, (s) => exportStatus = s); }
    catch (error) { exportStatus = `Export failed: ${(error as Error).message}`; }
    finally { exporting = false; }
  }

  function reviewRetake(id: string, attemptId: string) {
    const next = plain(project); const r = next.retakes.find((x) => x.id === id);
    if (r) { r.selected = attemptId; r.reviewed = true; const a = r.attempts.find((x) => x.id === attemptId); if (a) { r.trimStart = a.start; r.trimEnd = a.end; } }
    update(next);
  }
  function retakeTrim(id: string, edge: 'start' | 'end', value: number) {
    const next = plain(project); const r = next.retakes.find((x) => x.id === id); if (!r) return;
    if (edge === 'start') r.trimStart = Math.min(value, r.trimEnd - .05); else r.trimEnd = Math.max(value, r.trimStart + .05);
    update(next);
  }
  function pauseAction(id: string, action: 'keep' | 'shorten' | 'remove') {
    const next = plain(project); const p = next.pauses.find((x) => x.id === id); if (p) p.action = action; update(next);
  }
  function pauseBoundary(id: string, edge: 'start' | 'end', value: number) {
    const next = plain(project); const p = next.pauses.find((x) => x.id === id); if (!p) return;
    if (edge === 'start') p.start = Math.min(value, p.end - .05); else p.end = Math.max(value, p.start + .05);
    update(next);
  }

  function saveFx() {
    if (!fxTrack) return;
    const next = plain(project); const i = next.tracks.findIndex((t) => t.id === fxTrack!.id); if (i >= 0) next.tracks[i] = plain(fxTrack);
    fxTrack = null; update(next);
  }

  function shortcut(e: KeyboardEvent) {
    if ((e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable="true"]')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.code === 'Space') { e.preventDefault(); playing ? pause() : void play(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(false); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); redo(); }
    else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (e.key.toLowerCase() === 's') { e.preventDefault(); split(); }
    else if (e.key.toLowerCase() === 'x') { e.preventDefault(); remove(true); }
  }

  const online = () => { if (saveState === 'offline') void save(); };
  window.addEventListener('online', online);
  window.addEventListener('keydown', shortcut);
  onDestroy(() => { clearTimeout(timer); audio?.pause(); if (previewUrl) URL.revokeObjectURL(previewUrl); if (nextAudio) URL.revokeObjectURL(nextAudio.url); window.removeEventListener('online', online); window.removeEventListener('keydown', shortcut); });
</script>

<div class="flex h-full min-h-[620px] flex-col overflow-hidden bg-page" data-editor>
  <div class="flex h-14 flex-none items-center gap-3 border-b border-divider px-4">
    <a href={sessionsHref} class="text-[13px] text-text-2 hover:text-text">‹ Sessions</a>
    <div class="h-5 w-px bg-divider"></div>
    <div class="min-w-0 flex-1 truncate text-[14px]">{project.name}</div>
    <div class="flex items-center gap-2 text-[12px] text-text-2" aria-live="polite" data-save-state={saveState}>
      <span class:animate-pulse={saveState === 'saving'} class="size-1.5 rounded-full" class:bg-ok={saveState === 'saved'} class:bg-warn={saveState === 'saving' || saveState === 'offline'} class:bg-rec={saveState === 'failed' || saveState === 'conflict'}></span>
      {saveMessage}
    </div>
    <button data-retakes-open class="h-9 rounded-[10px] border border-border px-3 text-[13px] hover:border-handle" onclick={() => retakesOpen = true}>Retakes {pendingRetakes ? `(${pendingRetakes})` : ''}</button>
    <button data-pauses-open class="h-9 rounded-[10px] border border-border px-3 text-[13px] hover:border-handle" onclick={() => pausesOpen = true}>Pauses {project.pauses.length ? `(${project.pauses.length})` : ''}</button>
    <label class="flex h-9 cursor-pointer items-center rounded-[10px] border border-border px-3 text-[13px] hover:border-handle">{importing ? 'Importing…' : 'Import audio'}<input class="sr-only" type="file" accept="audio/*,.wav,.mp3,.m4a,.flac" disabled={importing} onchange={(e) => importFile(e.currentTarget.files?.[0])} /></label>
    <button data-export-open class="h-9 rounded-[10px] bg-text px-4 text-[13px] font-medium text-page" onclick={() => exportOpen = true}>Export</button>
  </div>
  {#if importError}<div class="border-b border-rec/30 bg-rec/5 px-4 py-2 text-[12px] text-rec">{importError}</div>{/if}
  <div class="flex min-h-0 flex-1 overflow-auto" data-timeline-scroll>
    <div class="relative min-w-full" style={`width:${HEADER + timelineWidth}px`}>
      <div class="sticky top-0 z-30 flex h-10 border-b border-divider bg-page/95 backdrop-blur">
        <div class="sticky left-0 z-40 flex w-[176px] flex-none items-center border-r border-divider bg-page px-4 text-[11px] font-mono text-text-3">TRACKS</div>
        <div class="relative flex-1" role="button" tabindex="0" aria-label="Timeline ruler" style={`width:${timelineWidth}px`} onclick={(e) => seek(point(e, e.currentTarget))} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') seek(playhead); }}>
          {#each Array(Math.ceil(duration / (zoom < 1 ? 30 : zoom > 3 ? 5 : 10)) + 1) as _, i}
            {@const step = zoom < 1 ? 30 : zoom > 3 ? 5 : 10}
            <div class="absolute top-0 h-full border-l border-divider" style={`left:${i * step * pxPerSecond}px`}><span class="ml-1.5 font-mono text-[10px] text-text-3">{fmt(i * step)}</span></div>
          {/each}
        </div>
      </div>
      <div class="sticky top-10 z-20 flex h-9 border-b border-divider bg-sheet">
        <div class="sticky left-0 z-30 flex w-[176px] flex-none items-center border-r border-divider bg-sheet px-4 text-[11px] text-text-3">MARKERS</div>
        <div class="relative" style={`width:${timelineWidth}px`}>
          {#each project.markers as marker}
            {#if label(marker.kind)}<button class="absolute top-1 h-6 -translate-x-1/2 rounded-[4px] border border-border bg-control px-1.5 font-mono text-[9px] text-text-2 hover:text-text" style={`left:${marker.t * pxPerSecond}px`} onclick={() => seek(marker.t)} title={`${label(marker.kind)} · ${fmt(marker.t)}`}>{label(marker.kind)}</button>{/if}
          {/each}
        </div>
      </div>
      {#each project.tracks as track}
        {@const view = viewFor(track.id)}
        <div data-track={track.id} class="flex h-[104px] border-b border-divider" class:bg-surface={track.id === selectedTrack}>
          <div class="sticky left-0 z-20 flex w-[176px] flex-none flex-col justify-center gap-2 border-r border-divider bg-page px-3">
            <div class="flex items-center gap-2"><span class="size-2 rounded-full" style={`background:${view?.color ?? 'var(--color-text-3)'}`}></span><button class="min-w-0 flex-1 truncate text-left text-[12px] font-medium" onclick={() => selectedTrack = track.id}>{track.name}</button></div>
            <div class="flex items-center gap-1.5">
              <button class="size-7 rounded-[7px] border border-border text-[11px]" class:bg-text={track.muted} class:text-page={track.muted} onclick={() => toggleMute(track.id)} aria-label={`Mute ${track.name}`}>M</button>
              <button class="size-7 rounded-[7px] border border-border text-[11px]" class:bg-text={solo.includes(track.id)} class:text-page={solo.includes(track.id)} onclick={() => toggleSolo(track.id)} aria-label={`Solo ${track.name}`}>S</button>
              <button data-track-fx class="h-7 rounded-[7px] border border-border px-2 text-[11px]" onclick={() => fxTrack = plain(track)}>FX</button>
              <span class="ml-auto font-mono text-[10px] text-text-3">{track.gainDb > 0 ? '+' : ''}{track.gainDb} dB</span>
            </div>
            <input aria-label={`${track.name} level`} type="range" min="-24" max="12" step="1" value={track.gainDb} oninput={(e) => level(track.id, Number(e.currentTarget.value))} />
          </div>
          <div class="relative flex-1 overflow-hidden" role="region" aria-label={`${track.name} timeline`} style={`width:${timelineWidth}px`} onpointerdown={beginSelection}>
            {#each track.clips as clip}
              {@const clipDuration = clip.sourceEnd - clip.sourceStart}
              <button data-clip class="absolute top-3 h-[78px] overflow-hidden rounded-[7px] border text-left" class:border-text={selectedClip === clip.id} class:border-border={selectedClip !== clip.id} class:opacity-40={track.muted} style={`left:${clip.timelineStart * pxPerSecond}px;width:${Math.max(4, clipDuration * pxPerSecond)}px;background:color-mix(in srgb, ${view?.color ?? 'var(--color-text-3)'} 12%, var(--color-surface))`} onclick={() => { selectedTrack = track.id; selectedClip = clip.id; }} onpointerdown={(e) => dragClip(e, track, clip.id)}>
                <span role="slider" aria-label="Trim clip start" aria-valuemin={clip.sourceStart} aria-valuemax={clip.sourceEnd} aria-valuenow={clip.sourceStart} tabindex="0" class="absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize bg-text/20" onpointerdown={(e) => trim(e, track, clip.id, 'start')}></span>
                <span role="slider" aria-label="Trim clip end" aria-valuemin={clip.sourceStart} aria-valuemax={clip.sourceEnd} aria-valuenow={clip.sourceEnd} tabindex="0" class="absolute right-0 top-0 z-10 h-full w-1.5 cursor-ew-resize bg-text/20" onpointerdown={(e) => trim(e, track, clip.id, 'end')}></span>
                <span class="absolute left-2 top-1 font-mono text-[9px] text-text-3">{clip.linked ? 'LINKED' : 'UNLINKED'}</span>
                <span class="absolute inset-x-0 bottom-2 top-5 flex items-center gap-px opacity-80" aria-hidden="true">
                  {#each (view?.peaks ?? []).slice(Math.floor(clip.sourceStart * 2), Math.ceil(clip.sourceEnd * 2)) as peak}
                    <i class="min-w-px flex-1 rounded-full" style={`height:${Math.max(2, peak * 46)}px;background:${view?.color ?? 'var(--color-text-3)'}`}></i>
                  {/each}
                </span>
              </button>
            {/each}
            {#if hasSelection}<div class="pointer-events-none absolute inset-y-0 bg-info/15 outline outline-1 outline-info" style={`left:${selection[0] * pxPerSecond}px;width:${(selection[1] - selection[0]) * pxPerSecond}px`}></div>{/if}
          </div>
        </div>
      {/each}
      <div class="pointer-events-none absolute bottom-0 top-0 z-40 w-px bg-rec" style={`left:${HEADER + playhead * pxPerSecond}px`}><span class="absolute -left-1.5 top-0 size-3 rotate-45 bg-rec"></span></div>
    </div>
  </div>
  <div class="flex h-[66px] flex-none items-center gap-3 border-t border-divider bg-surface px-4">
    <button data-editor-play class="size-9 rounded-full bg-text text-page" onclick={() => playing ? pause() : void play()} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'Ⅱ' : '▶'}</button>
    <button class="size-9 rounded-[10px] border border-border text-[12px]" onclick={stop} aria-label="Stop">■</button>
    <span class="w-[58px] font-mono text-[12px]">{fmt(playhead)}</span>
    <input class="min-w-[160px] flex-1" aria-label="Playhead" type="range" min="0" max={Math.max(.01, duration)} step=".01" value={playhead} oninput={(e) => seek(Number(e.currentTarget.value))} />
    <span class="font-mono text-[12px] text-text-2">{fmt(duration)}</span>
    <div class="h-6 w-px bg-divider"></div>
    <button class="h-8 rounded-[8px] border border-border px-2 text-[12px] disabled:opacity-30" disabled={!history.length} onclick={undo}>Undo</button>
    <button class="h-8 rounded-[8px] border border-border px-2 text-[12px] disabled:opacity-30" disabled={!future.length} onclick={redo}>Redo</button>
    <button class="h-8 rounded-[8px] border border-border px-2 text-[12px]" onclick={split}>Split</button>
    <button class="h-8 rounded-[8px] border border-border px-2 text-[12px] disabled:opacity-30" disabled={!selectedClip} onclick={unlinkSelected}>{project.tracks.find((t) => t.id === selectedTrack)?.clips.find((c) => c.id === selectedClip)?.linked === false ? 'Link' : 'Unlink'}</button>
    <button class="h-8 rounded-[8px] border border-border px-2 text-[12px] disabled:opacity-30" disabled={!hasSelection} onclick={() => remove(false)}>Delete</button>
    <button class="h-8 rounded-[8px] border border-border px-2 text-[12px] disabled:opacity-30" disabled={!hasSelection} onclick={() => remove(true)}>Ripple cut</button>
    <span class="ml-2 text-[11px] text-text-3">Zoom</span><input class="w-24" aria-label="Timeline zoom" type="range" min=".5" max="6" step=".5" bind:value={zoom} />
    {#if loadingAudio}<span class="font-mono text-[10px] text-text-3">BUFFERING</span>{/if}
  </div>
</div>

<Sheet bind:open={retakesOpen} labelledby="retakes-title">
  {#snippet header()}<div><h2 id="retakes-title" class="text-[18px]">Review retakes</h2><p class="mt-1 text-[13px] text-text-2">Choose the attempt that belongs in the finished mix. Sources remain untouched.</p></div>{/snippet}
  <div class="flex flex-col gap-3">
    {#if !project.retakes.length}<p class="py-6 text-[13px] text-text-2">No retakes were marked.</p>{/if}
    {#each project.retakes as retake}
      {@const chosen = retake.attempts.find((a) => a.id === retake.selected)}
      <div class="rounded-[12px] bg-surface p-4" data-retake={retake.id}>
        <div class="mb-3 flex items-center justify-between"><strong class="text-[14px]">Line {retake.line + 1}</strong><span class="font-mono text-[10px]" class:text-ok={retake.reviewed} class:text-warn={!retake.reviewed}>{retake.reviewed ? 'REVIEWED' : 'REVIEW NEEDED'}</span></div>
        <div class="flex flex-wrap gap-2">
          {#each retake.attempts as attempt}
            <button class="h-9 rounded-[9px] border px-3 text-[12px]" class:border-text={retake.selected === attempt.id} class:border-border={retake.selected !== attempt.id} onclick={() => reviewRetake(retake.id, attempt.id)}>Attempt {attempt.number} · {fmt(attempt.start)}–{fmt(attempt.end)}</button>
          {/each}
        </div>
        <button class="mt-3 h-9 rounded-[9px] bg-text px-3 text-[12px] text-page" onclick={() => reviewRetake(retake.id, retake.attempts.at(-1)!.id)}>Keep last take</button>
        {#if chosen}<div class="mt-4 grid grid-cols-[1fr_auto] gap-3 border-t border-divider pt-4">
          <div class="flex flex-col gap-3">
            <label class="text-[11px] text-text-3">Take start · {retake.trimStart.toFixed(2)} s<input class="mt-1 w-full" type="range" min={chosen.start} max={chosen.end - .05} step=".01" value={retake.trimStart} oninput={(e) => retakeTrim(retake.id, 'start', Number(e.currentTarget.value))} /></label>
            <label class="text-[11px] text-text-3">Take end · {retake.trimEnd.toFixed(2)} s<input class="mt-1 w-full" type="range" min={chosen.start + .05} max={chosen.end} step=".01" value={retake.trimEnd} oninput={(e) => retakeTrim(retake.id, 'end', Number(e.currentTarget.value))} /></label>
          </div>
          <div class="flex flex-col gap-2"><button class="h-8 rounded-[8px] border border-border px-2 text-[11px]" onclick={() => previewJoin(retake.trimStart)}>Loop start join</button><button class="h-8 rounded-[8px] border border-border px-2 text-[11px]" onclick={() => previewJoin(retake.trimEnd)}>Loop end join</button></div>
        </div>{/if}
      </div>
    {/each}
  </div>
</Sheet>

<Sheet bind:open={pausesOpen} labelledby="pauses-title">
  {#snippet header()}<div><h2 id="pauses-title" class="text-[18px]">Pause suggestions</h2><p class="mt-1 text-[13px] text-text-2">Natural pacing stays unless you choose a change.</p></div>{/snippet}
  <div class="flex flex-col gap-3">
    {#if !project.pauses.length}<p class="py-6 text-[13px] text-text-2">No pauses longer than three seconds were found.</p>{/if}
    {#each project.pauses as p}
      <div class="rounded-[12px] bg-surface p-4"><div class="mb-3 text-[13px]">{fmt(p.start)}–{fmt(p.end)} · {(p.end-p.start).toFixed(1)} s</div><div class="grid grid-cols-3 rounded-[10px] border border-border p-1">{#each [['keep','Leave unchanged'],['shorten','Shorten to 1 s'],['remove','Remove']] as option}<button class="h-8 rounded-[7px] text-[12px]" class:bg-text={p.action === option[0]} class:text-page={p.action === option[0]} onclick={() => pauseAction(p.id, option[0] as 'keep'|'shorten'|'remove')}>{option[1]}</button>{/each}</div>{#if p.action !== 'keep'}<div class="mt-4 grid grid-cols-2 gap-4 border-t border-divider pt-4"><label class="text-[11px] text-text-3">Start · {p.start.toFixed(2)} s<input class="mt-1 w-full" type="range" min="0" max={p.end-.05} step=".01" value={p.start} oninput={(e) => pauseBoundary(p.id, 'start', Number(e.currentTarget.value))} /></label><label class="text-[11px] text-text-3">End · {p.end.toFixed(2)} s<input class="mt-1 w-full" type="range" min={p.start+.05} max={duration} step=".01" value={p.end} oninput={(e) => pauseBoundary(p.id, 'end', Number(e.currentTarget.value))} /></label></div>{/if}</div>
    {/each}
  </div>
</Sheet>

<Sheet open={!!fxTrack} labelledby="fx-title" onclose={() => fxTrack = null}>
  {#snippet header()}<div><h2 id="fx-title" class="text-[18px]">{fxTrack?.name} FX</h2><p class="mt-1 text-[13px] text-text-2">Simple processing for spoken-word audio.</p></div>{/snippet}
  {#if fxTrack}<div class="flex flex-col gap-5">
    {#if fxTrack.kind === 'voice'}<label class="flex flex-col gap-2 text-[13px]"><span class="flex justify-between">Noise reduction <span class="font-mono text-text-3">{fxTrack.fx.noise}%</span></span><input type="range" min="0" max="100" bind:value={fxTrack.fx.noise} /></label>{/if}
    {#each [['low','Low'],['mid','Mid'],['high','High']] as band}<label class="flex flex-col gap-2 text-[13px]"><span class="flex justify-between">{band[1]} <span class="font-mono text-text-3">{fxTrack.fx[band[0] as 'low'|'mid'|'high']} dB</span></span><input type="range" min="-12" max="12" step="1" bind:value={fxTrack.fx[band[0] as 'low'|'mid'|'high']} /></label>{/each}
    <label class="flex flex-col gap-2 text-[13px]">Compression<select class="h-10 rounded-[10px] border border-border bg-page px-3" bind:value={fxTrack.fx.compression}>{#each ['Off','Light','Medium','Heavy'] as value}<option>{value}</option>{/each}</select></label>
    {#if fxTrack.kind === 'voice'}<label class="flex items-center justify-between rounded-[10px] bg-surface p-3 text-[13px]">Automatic speech leveling<input type="checkbox" bind:checked={fxTrack.fx.level} /></label>{/if}
  </div>{/if}
  {#snippet footer()}<div class="flex justify-end gap-2"><button class="h-9 rounded-[9px] border border-border px-3 text-[13px]" onclick={() => fxTrack = null}>Cancel</button><button class="h-9 rounded-[9px] bg-text px-4 text-[13px] text-page" onclick={saveFx}>Apply FX</button></div>{/snippet}
</Sheet>

<Sheet bind:open={exportOpen} labelledby="export-title" onclose={() => { completed = null; exportStatus = ''; }}>
  {#snippet header()}<div><h2 id="export-title" class="text-[18px]">Export episode</h2><p class="mt-1 text-[13px] text-text-2">The finished WAV includes every reviewed edit and track setting.</p></div>{/snippet}
  {#if completed}<div class="py-8 text-center" data-export-complete><div class="mx-auto mb-4 flex size-10 items-center justify-center rounded-full bg-ok/15 text-ok">✓</div><h3 class="text-[17px]">Your export is ready</h3><p class="mt-2 text-[13px] text-text-2">{completed.filename}</p><div class="mt-5 flex justify-center gap-2"><a class="flex h-9 items-center rounded-[9px] bg-text px-3 text-[13px] text-page" href={sessionsHref}>Back to sessions</a><button class="h-9 rounded-[9px] border border-border px-3 text-[13px]" onclick={completed.downloadAgain}>Download again</button></div><div class="mt-8 rounded-[12px] border border-dashed border-border p-4 text-left opacity-50"><div class="text-[13px]">Optional AI tools</div><div class="mt-1 text-[12px] text-text-3">Coming soon</div></div></div>
  {:else}<div class="flex flex-col gap-3">
    <label class="flex items-center justify-between rounded-[12px] bg-surface p-4 text-[13px]">Finished WAV <input type="checkbox" checked disabled /></label>
    <label class="flex items-center justify-between rounded-[12px] bg-surface p-4 text-[13px]">Also make MP3 <input type="checkbox" bind:checked={project.master.mp3} onchange={queueSave} /></label>
    <label class="flex items-center justify-between rounded-[12px] bg-surface p-4 text-[13px]">Include raw tracks <input type="checkbox" bind:checked={project.master.rawTracks} onchange={queueSave} /></label>
    {#if pendingRetakes}<p class="rounded-[10px] bg-warn/10 p-3 text-[12px] text-warn">Review every retake group before exporting the finished mix.</p>{/if}
    {#if exportStatus}<p class="text-[12px] text-text-2" aria-live="polite">{exportStatus}</p>{/if}
  </div>{/if}
  {#snippet footer()}{#if !completed}<div class="flex justify-end gap-2"><button class="h-9 rounded-[9px] border border-border px-3 text-[13px]" onclick={() => exportOpen = false}>Cancel</button><button class="h-9 rounded-[9px] bg-text px-4 text-[13px] text-page disabled:opacity-40" disabled={exporting || !!pendingRetakes} onclick={runExport}>{exporting ? 'Exporting…' : 'Export'}</button></div>{/if}{/snippet}
</Sheet>

<Sheet open={!!conflict} labelledby="conflict-title">
  {#snippet header()}<div><h2 id="conflict-title" class="text-[18px]">Project changed elsewhere</h2><p class="mt-1 text-[13px] text-text-2">Autosave is paused so neither version is overwritten.</p></div>{/snippet}
  <p class="text-[13px] leading-relaxed text-text-2">Load the server version, or keep this browser’s edits and overwrite it.</p>
  {#snippet footer()}<div class="flex justify-end gap-2"><button class="h-9 rounded-[9px] border border-border px-3 text-[13px]" onclick={reloadConflict}>Reload server version</button><button class="h-9 rounded-[9px] bg-text px-4 text-[13px] text-page" onclick={overwriteConflict}>Overwrite with this version</button></div>{/snippet}
</Sheet>
