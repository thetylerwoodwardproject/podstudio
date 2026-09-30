<script lang="ts" module>
  import type { EditorProjectV1, EditorTrack } from '@/lib/editor-project';

  export type EditorSaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'failed' | 'conflict';
  export interface EditorPreview { url: string; duration: number }
  export interface EditorExportResult { filename: string; downloadAgain: () => void }
  export interface EditorConflict { project: EditorProjectV1; revision: number }
  export interface EditorTrackView { id: string; peaks: number[]; color: string; status?: 'loading' | 'ready' | 'error'; error?: string }
  export interface EditorSaveResult { revision: number; conflict?: EditorConflict }
  export interface EditorProps {
    sessions: { id: string; name: string }[];
    onanalyze: (project: EditorProjectV1, progress: (s: string) => void, signal: AbortSignal) => Promise<{ result: number; measured: number; range: number | null; truePeak: number }>;
    sessionsHref: string;
    initial: EditorProjectV1;
    revision: number;
    views: EditorTrackView[];
    onpreview: (project: EditorProjectV1, from: number, seconds: number, solo: string[], mastered?: boolean) => Promise<EditorPreview>;
    onsave: (project: EditorProjectV1, revision: number, force?: boolean) => Promise<EditorSaveResult>;
    onimport: (file: File, at: number, progress: (s: string) => void) => Promise<{ track: EditorTrack; peaks: number[] }>;
    onexport: (project: EditorProjectV1, progress: (message: string) => void) => Promise<EditorExportResult>;
    onpeaks: (track: EditorTrack, from: number, to: number, onChunk: (chunk: { start: number; peaks: number[] }) => void) => Promise<void>;
  }
</script>

<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import EditorFxControls from './EditorFxControls.svelte';
  import { cleanMaster, cleanEditorProject, deleteClip, timelineMarkers, defaultFx, removeEditorTrack, restoreEditorTrack } from '@/lib/editor-project';
  import { crossfadeSpan } from '@/lib/editor-crossfades';
  import Sheet from '@/components/ui/Sheet.svelte';
  import { Button } from '@/components/shadcn/button';
  import * as DropdownMenu from '@/components/shadcn/dropdown-menu';
  import * as AlertDialog from '@/components/shadcn/alert-dialog';
  import * as Popover from '@/components/shadcn/popover';
  import { Input } from '@/components/shadcn/input';
  import { Slider } from '@/components/shadcn/slider';
  import { PEAK_SECONDS, waveformBars } from '@/lib/audio/editor-peaks';
  import {
    deleteRange,
    moveClip,
    projectDuration,
    splitProject,
    trimClip,
  } from '@/lib/editor-project';

  let { sessions, onanalyze, sessionsHref, initial, revision: initialRevision, views, onpreview, onsave, onimport, onexport, onpeaks }: EditorProps = $props();
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
  let importStatus = $state('');
  let playbackError = $state('');
  let playbackStatus = $state('');
  let importDismissTimer = 0;
  let pendingImport = $state<File | undefined>();
  let importAt = 0;
  let gestureCancel: (() => void) | null = null;
  let loudnessOpen = $state(false);
  let masterDraft = $state(cleanMaster(initial.master));
  let mastered = $state(false);
  let measurement = $state<{ result: number; measured: number; range: number | null; truePeak: number } | null>(null);
  let measurementKey = $state('');
  let analysisStatus = $state('');
  let analyzing = $state(false);
  let analysisAbort: AbortController | null = null;
  let fxBypass = $state(false);
  let fxPreviewing = $state(false);
  let fxTimer = 0;
  let removingTrack = $state<string | null>(null);
  let removeOpen = $state(false);
  let editMenuOpen = $state(false);
  let clipPopoverOpen = $state(false);
  let clipAnchor = $state<HTMLElement | null>(null);
  let clipDraft = $state({ position: '', start: '', end: '' });
  let clipInputError = $state('');
  let waveformGeneration = 0;
  let prefetching = false;
  let prefetchTask: Promise<void> | null = null;
  let visibleFrom = $state(0);
  let visibleTo = $state(150);
  const selected = $derived(project.tracks.find((t) => t.id === selectedTrack)?.clips.find((c) => c.id === selectedClip));
  const visibleMarkers = $derived(timelineMarkers(project));
  const soundKey = (value: EditorProjectV1) => JSON.stringify({ tracks: value.tracks, markers: value.markers, retakes: value.retakes, pauses: value.pauses, master: cleanMaster(value.master), crossfades: value.crossfades });
  const measurementStale = $derived(measurementKey !== soundKey({ ...project, master: masterDraft }));
  function invalidateAudio() {
    ++playTimer; prefetching = false; prefetchTask = null;
    audio?.pause(); audio = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = '';
    if (nextAudio) URL.revokeObjectURL(nextAudio.url); nextAudio = null;
  }
  function refreshAudio() { const resume = playing; invalidateAudio(); if (resume) void loadWindow(playhead, true); }
  async function switchSession(id: string) {
    if (id === project.takeId || conflict) return;
    clearTimeout(timer); await save();
    if (saveState === 'saved') location.href = `${sessionsHref.replace(/sessions$/, 'editor')}?take=${encodeURIComponent(id)}`;
  }
  function previewProject() {
    const next = plain(project);
    if (fxTrack) { const i = next.tracks.findIndex((t) => t.id === fxTrack!.id); if (i >= 0) next.tracks[i] = { ...plain(fxTrack), fx: fxBypass ? defaultFx(false) : plain(fxTrack.fx) }; }
    return next;
  }
  function closeFx() { clearTimeout(fxTimer); fxTrack = null; fxPreviewing = false; fxBypass = false; refreshAudio(); }
  $effect(() => {
    if (!fxTrack || !fxPreviewing) return;
    JSON.stringify(fxTrack.fx); fxBypass;
    clearTimeout(fxTimer); fxTimer = window.setTimeout(() => { invalidateAudio(); void loadWindow(playhead, true); }, 200);
  });
  async function analyze() {
    analysisAbort?.abort(); analysisAbort = new AbortController(); analyzing = true;
    const value = { ...plain(project), master: cleanMaster(plain(masterDraft)) }; const key = soundKey(value);
    try { measurement = await onanalyze(value, (s) => analysisStatus = s, analysisAbort.signal); measurementKey = key; analysisStatus = 'Analysis complete'; }
    catch (error) { analysisStatus = (error as Error).name === 'AbortError' ? 'Analysis cancelled' : (error as Error).message; }
    finally { analyzing = false; }
  }
  function closeLoudness() { analysisAbort?.abort(); loudnessOpen = false; }
  function applyMaster() { update({ ...plain(project), master: cleanMaster(plain(masterDraft)) }); closeLoudness(); }

  let audio: HTMLAudioElement | null = null;
  let nextAudio: { at: number; element: HTMLAudioElement; url: string; duration: number } | null = null;
  let previewUrl = '';
  let playing = $state(false);
  let loadingAudio = $state(false);
  let timer = 0;
  let saving: Promise<void> | null = null;
  let playTimer = 0;
  const HEADER = 176;
  const duration = $derived(projectDuration(project));
  const pxPerSecond = $derived(8 * zoom);
  const timelineWidth = $derived(Math.max(900, duration * pxPerSecond));
  const selection = $derived([Math.min(selectionStart, selectionEnd), Math.max(selectionStart, selectionEnd)] as [number, number]);
  const hasSelection = $derived(selection[1] - selection[0] > 0.01);
  const pendingRetakes = $derived(project.tracks.some((t) => t.kind === 'voice' && t.role === 'host') ? project.retakes.filter((r) => !r.reviewed).length : 0);
  const plain = <T,>(value: T): T => structuredClone($state.snapshot(value) as T);

  const fmt = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
  };
  const fmtPrecise = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${(Math.max(0, seconds) % 60).toFixed(3).padStart(6, '0')}`;
  function parseTime(text: string) {
    const match = /^(?:(\d+):)?(\d+(?:\.\d{1,3})?)$/.exec(text.trim());
    if (!match) return NaN;
    return Number(match[1] ?? 0) * 60 + Number(match[2]);
  }
  function openClipPopover(node: HTMLElement, clip: { timelineStart: number; sourceStart: number; sourceEnd: number }) {
    clipAnchor = node;
    clipDraft = { position: fmtPrecise(clip.timelineStart), start: fmtPrecise(clip.sourceStart), end: fmtPrecise(clip.sourceEnd) };
    clipInputError = ''; clipPopoverOpen = true;
  }
  function commitClipField(field: 'position' | 'start' | 'end') {
    const value = parseTime(clipDraft[field]);
    if (!Number.isFinite(value) || value < 0) { clipInputError = 'Use a time such as 1:23.456.'; return; }
    const currentValue = field === 'position' ? selected?.timelineStart : field === 'start' ? selected?.sourceStart : selected?.sourceEnd;
    if (currentValue !== undefined && Math.abs(value - currentValue) < .0005) { clipInputError = ''; return; }
    clipInputError = ''; numericClip(field, value);
    const current = project.tracks.find((track) => track.id === selectedTrack)?.clips.find((clip) => clip.id === selectedClip);
    if (current) clipDraft = { position: fmtPrecise(current.timelineStart), start: fmtPrecise(current.sourceStart), end: fmtPrecise(current.sourceEnd) };
  }
  const label = (kind: string) => ({ retake: 'RET', cut: 'COUGH', adlib: 'AD-LIB', pause: 'PAUSE', gap: 'MIC' }[kind] ?? '');
  const viewFor = (id: string) => views.find((v) => v.id === id);

  async function loadPeaks(track: EditorTrack, from: number, to: number) {
    const generation = waveformGeneration;
    const existing = viewFor(track.id);
    if (existing && Array.from({ length: Math.ceil(to / PEAK_SECONDS) - Math.floor(from / PEAK_SECONDS) }, (_, index) => existing.peaks[Math.floor(from / PEAK_SECONDS) + index]).every((peak) => peak !== undefined)) return;
    views = views.map((view) => view.id === track.id ? { ...view, status: 'loading', error: undefined } : view);
    try {
      await onpeaks(track, from, to, (chunk) => {
        if (generation !== waveformGeneration) return;
        views = views.map((view) => {
          if (view.id !== track.id) return view;
          const peaks = [...view.peaks];
          for (let i = 0; i < chunk.peaks.length; i++) peaks[chunk.start + i] = chunk.peaks[i];
          return { ...view, peaks, status: 'ready' };
        });
      });
      if (generation === waveformGeneration) views = views.map((view) => view.id === track.id && view.status === 'loading' ? { ...view, status: 'ready' } : view);
    } catch (error) {
      if (generation === waveformGeneration) views = views.map((view) => view.id === track.id ? { ...view, status: 'error', error: (error as Error).message } : view);
    }
  }

  async function visiblePeaks(scroll: HTMLElement) {
    const from = Math.max(0, (scroll.scrollLeft - HEADER) / pxPerSecond);
    const to = Math.min(duration, (scroll.scrollLeft + scroll.clientWidth - HEADER) / pxPerSecond);
    visibleFrom = from; visibleTo = to;
    await Promise.all(project.tracks.flatMap((track) => track.clips.flatMap((clip) => {
      const start = Math.max(from, clip.timelineStart);
      const end = Math.min(to, clip.timelineStart + clip.sourceEnd - clip.sourceStart);
      return end > start ? [loadPeaks(track, clip.sourceStart + start - clip.timelineStart, clip.sourceStart + end - clip.timelineStart)] : [];
    })));
  }

  onMount(() => {
    const scroll = document.querySelector<HTMLElement>('[data-timeline-scroll]');
    if (!scroll) return;
    let timer = 0;
    const onScroll = () => { clearTimeout(timer); timer = window.setTimeout(() => void visiblePeaks(scroll), 100); };
    scroll.addEventListener('scroll', onScroll);
    void visiblePeaks(scroll);
    return () => { ++waveformGeneration; clearTimeout(timer); scroll.removeEventListener('scroll', onScroll); };
  });
  $effect(() => {
    zoom; project.tracks;
    void tick().then(() => { const scroll = document.querySelector<HTMLElement>('[data-timeline-scroll]'); if (scroll) void visiblePeaks(scroll); });
  });

  function update(next: EditorProjectV1, record = true) {
    if (record) {
      history = [...history.slice(-99), plain(project)];
      future = [];
    }
    project = next;
    project.updatedAt = Date.now();
    queueSave();
    refreshAudio();
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    future = [plain(project), ...future];
    history = history.slice(0, -1);
    project = previous;
    queueSave(); refreshAudio();
  }
  function redo() {
    const next = future[0];
    if (!next) return;
    history = [...history, plain(project)];
    future = future.slice(1);
    project = next;
    queueSave(); refreshAudio();
  }

  function queueSave() {
    localStorage.setItem(`podstudio-editor-${project.takeId}`, JSON.stringify(project));
    saveState = navigator.onLine ? 'saving' : 'offline';
    saveMessage = navigator.onLine ? 'Saving…' : 'Waiting for connection';
    clearTimeout(timer);
    timer = window.setTimeout(save, 650);
  }

  async function save(force = false): Promise<void> {
    if (saving) { await saving; if (!conflict) return save(force); return; }
    if (conflict && !force) return;
    saving = persist(force);
    try { await saving; } finally { saving = null; }
  }
  async function persist(force = false) {
    if (!navigator.onLine) {
      saveState = 'offline'; saveMessage = 'Waiting for connection'; return;
    }
    saveState = 'saving'; saveMessage = 'Saving…';
    const sent = plain(project);
    try {
      const result = await onsave(sent, revision, force);
      if (result.conflict) {
        conflict = result.conflict; saveState = 'conflict'; saveMessage = 'Project changed elsewhere'; return;
      }
      revision = result.revision;
      if (JSON.stringify(sent) !== JSON.stringify(plain(project))) { queueSave(); return; }
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
  function gesture(e: PointerEvent, change: (dx: number, x: number) => void, edit = true, click?: () => void) {
    e.preventDefault(); e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.focus({ preventScroll: true });
    const scroll = target.closest('[data-timeline-scroll]') as HTMLElement;
    const original = plain(project), originalPlayhead = playhead;
    const start = e.clientX, scrollStart = scroll.scrollLeft;
    let x = start, changed = false, frame = 0;
    target.setPointerCapture(e.pointerId);
    const paint = () => {
      const rect = scroll.getBoundingClientRect();
      if (x > rect.right - 35) scroll.scrollLeft += 12;
      else if (x < rect.left + HEADER + 25) scroll.scrollLeft -= 12;
      change((x - start + scroll.scrollLeft - scrollStart) / pxPerSecond, x);
      frame = requestAnimationFrame(paint);
    };
    const move = (ev: PointerEvent) => { if (ev.pointerId !== e.pointerId) return; x = ev.clientX; if (Math.abs(x - start) > 3) { changed = true; if (!frame) paint(); } };
    const finish = (cancel = false) => {
      if (!cancel && changed) change((x - start + scroll.scrollLeft - scrollStart) / pxPerSecond, x);
      cancelAnimationFrame(frame); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancelEvent); window.removeEventListener('keydown', key);
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
      gestureCancel = null;
      if (cancel) { project = original; playhead = originalPlayhead; selectionStart = selectionEnd = playhead; }
      else if (edit && changed) { clipPopoverOpen = false; const final = project; project = original; update(final); }
      else if (!changed) click?.();
    };
    const up = (ev: PointerEvent) => { if (ev.pointerId === e.pointerId) finish(); }; const cancelEvent = () => finish(true);
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); finish(true); } };
    gestureCancel = cancelEvent;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancelEvent); window.addEventListener('keydown', key);
  }
  function beginSelection(e: PointerEvent, track?: EditorTrack, clipId?: string) {
    const node = (e.currentTarget as HTMLElement).closest('[data-lane], [data-ruler]') as HTMLElement;
    if (!node) return;
    selectedTrack = track?.id ?? '';
    selectedClip = clipId ?? '';
    const start = point(e, node); selectionStart = selectionEnd = start; seek(start);
    gesture(e, (dx) => selectionEnd = Math.max(0, Math.min(duration, start + dx)), false);
  }
  function dragClip(e: PointerEvent, track: EditorTrack, clipId: string) {
    if (e.shiftKey) { beginSelection(e, track, clipId); return; }
    selectedTrack = track.id; selectedClip = clipId; selectionStart = selectionEnd = playhead;
    const original = plain(project), clip = track.clips.find((c) => c.id === clipId)!;
    const at = clip.timelineStart; const unlink = e.altKey;
    const node = e.currentTarget as HTMLElement;
    const clickAt = point(e, (e.currentTarget as HTMLElement).closest('[data-lane]') as HTMLElement);
    gesture(e, (dx) => project = moveClip(original, track.id, clipId, Math.max(0, at + dx), unlink), true, () => { seek(clickAt); openClipPopover(node, clip); });
  }
  function trim(e: PointerEvent, track: EditorTrack, clipId: string, edge: 'start' | 'end') {
    selectedTrack = track.id; selectedClip = clipId;
    const original = plain(project);
    gesture(e, (dx) => project = trimClip(original, track.id, clipId, edge, edge === 'start' ? dx : -dx));
  }
  function numericClip(field: 'position' | 'start' | 'end', value: number) {
    if (!selected || !Number.isFinite(value)) return;
    if ((field === 'start' && value >= selected.sourceEnd - .01) || (field === 'end' && value <= selected.sourceStart + .01)) { clipInputError = 'Start must be before end.'; return; }
    update(field === 'position' ? moveClip(plain(project), selectedTrack, selectedClip, value) : trimClip(plain(project), selectedTrack, selectedClip, field, field === 'start' ? value - selected.sourceStart : selected.sourceEnd - value));
  }
  function remove(ripple: boolean) {
    if (!hasSelection) { if (selectedClip && !ripple) update(deleteClip(plain(project), selectedTrack, selectedClip)); return; }
    update(deleteRange(plain(project), selection[0], selection[1], ripple, selectedTrack || undefined));
    playhead = selection[0]; selectionStart = selectionEnd = playhead;
  }
  function split() { update(splitProject(plain(project), playhead, selectedTrack || undefined)); }
  function unlinkSelected() {
    if (!selectedClip) return;
    const next = plain(project);
    const clip = next.tracks.find((t) => t.id === selectedTrack)?.clips.find((c) => c.id === selectedClip);
    if (clip) clip.linked = !clip.linked;
    update(next);
  }

  function confirmRemoveTrack() {
    if (!removingTrack) return;
    const id = removingTrack;
    update(removeEditorTrack(plain(project), id));
    solo = solo.filter((value) => value !== id);
    if (selectedTrack === id) { selectedTrack = project.tracks[0]?.id ?? ''; selectedClip = ''; }
    removingTrack = null;
    removeOpen = false;
  }
  function restoreTrack(id: string) {
    update(restoreEditorTrack(plain(project), id));
    selectedTrack = id; selectedClip = '';
    const track = project.tracks.find((value) => value.id === id);
    if (track) for (const clip of track.clips) void loadPeaks(track, clip.sourceStart, clip.sourceEnd);
  }

  function toggleMute(id: string) {
    const next = plain(project); const track = next.tracks.find((t) => t.id === id);
    if (track) track.muted = !track.muted;
    update(next);
  }
  function toggleSolo(id: string) { mastered = false; solo = solo.includes(id) ? solo.filter((x) => x !== id) : [...solo, id]; if (playing) void loadWindow(playhead, true); }
  function level(id: string, gainDb: number) {
    const next = plain(project); const track = next.tracks.find((t) => t.id === id);
    if (track) track.gainDb = gainDb;
    update(next);
  }

  async function loadWindow(at: number, autoplay: boolean, windowSeconds = 4, loop = false) {
    const token = ++playTimer;
    loadingAudio = true; playbackError = ''; playbackStatus = 'Preparing audio…';
    try {
      const result = await onpreview(previewProject(), at, windowSeconds, $state.snapshot(solo), mastered && !fxTrack);
      if (token !== playTimer) { URL.revokeObjectURL(result.url); return; }
      if (result.duration <= .001) { URL.revokeObjectURL(result.url); pause(); return; }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (nextAudio) { URL.revokeObjectURL(nextAudio.url); nextAudio = null; }
      previewUrl = result.url;
      audio?.pause();
      audio = new Audio(result.url);
      audio.loop = loop;
      wireAudio(audio, at, result.duration);
      if (autoplay) { await audio.play(); playing = true; if (!loop && at + result.duration < duration - .01) void prefetch(at + result.duration, 8); }
    } catch (error) {
      playbackError = `Playback failed: ${(error as Error).message}`; playing = false;
    } finally { if (token === playTimer) { loadingAudio = false; playbackStatus = ''; } }
  }
  async function previewJoin(at: number) { await loadWindow(Math.max(0, at - 2), true, 4, true); }
  function wireAudio(element: HTMLAudioElement, at: number, seconds: number) {
    element.onended = async () => {
      const generation = playTimer;
      playhead = Math.min(duration, at + seconds);
      if (!nextAudio && prefetchTask) { playbackStatus = 'Waiting for audio…'; await prefetchTask; playbackStatus = ''; }
      if (generation !== playTimer || !playing) return;
      if (nextAudio && Math.abs(nextAudio.at - playhead) < .1) {
        URL.revokeObjectURL(previewUrl); previewUrl = nextAudio.url; audio = nextAudio.element; const nextAt = nextAudio.at; const nextSeconds = nextAudio.duration; nextAudio = null;
        wireAudio(audio, nextAt, nextSeconds); void audio.play();
        if (nextAt + nextSeconds < duration - .01) void prefetch(nextAt + nextSeconds, Math.min(30, Math.max(16, nextSeconds * 2)));
      } else if (playhead < duration - .01) void loadWindow(playhead, true);
      else playing = false;
    };
    element.ontimeupdate = () => {
      playhead = Math.min(duration, at + element.currentTime);
      if (!nextAudio && !prefetching && at + seconds < duration && element.currentTime > .25) void prefetch(at + seconds, Math.min(30, Math.max(8, seconds * 2)));
    };
  }
  function prefetch(at: number, seconds: number) {
    if (prefetching || nextAudio) return prefetchTask ?? Promise.resolve();
    prefetching = true; const generation = playTimer;
    const task = (async () => {
      try {
        const result = await onpreview(previewProject(), at, seconds, $state.snapshot(solo), mastered && !fxTrack);
        if (generation !== playTimer) { URL.revokeObjectURL(result.url); return; }
        const element = new Audio(result.url); element.preload = 'auto'; element.load();
        nextAudio = { at, element, url: result.url, duration: result.duration };
      } catch (error) { if (generation === playTimer) playbackError = `Next audio window failed: ${(error as Error).message}`; }
      finally { if (generation === playTimer) { prefetching = false; prefetchTask = null; } }
    })();
    prefetchTask = task;
    return task;
  }
  async function play() {
    if (loadingAudio) return;
    if (audio && previewUrl && audio.paused && audio.currentTime < audio.duration - .05) { await audio.play(); playing = true; return; }
    await loadWindow(playhead, true);
  }
  function pause() { audio?.pause(); playing = false; }
  function stop() { invalidateAudio(); playing = false; playbackStatus = ''; playhead = 0; }
  function seek(at: number) { invalidateAudio(); playing = false; playhead = Math.max(0, Math.min(duration, at)); }

  async function importFile(file: File | undefined) {
    if (!file) return;
    if (importing) return;
    if (file !== pendingImport) importAt = playhead;
    clearTimeout(importDismissTimer);
    pendingImport = file; importing = true; importError = ''; importStatus = 'Reading audio…';
    try {
      const result = await onimport(file, importAt, (s) => importStatus = s);
      views = [...views, { id: result.track.id, peaks: result.peaks, color: 'var(--color-adlib)' }];
      update({ ...plain(project), tracks: [...plain(project.tracks), result.track] });
      void loadPeaks(result.track, 0, Math.min(60, result.track.clips[0]?.sourceEnd ?? 0));
      selectedTrack = result.track.id; pendingImport = undefined; importStatus = 'Audio added';
      importDismissTimer = window.setTimeout(() => { if (!importing && !importError) importStatus = ''; }, 5000);
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
    fxTrack = null; fxPreviewing = false; fxBypass = false; clearTimeout(fxTimer); update(cleanEditorProject(next) ?? next);
  }

  function shortcut(e: KeyboardEvent) {
    if (gestureCancel || document.querySelector('dialog[open]')) return;
    if ((e.target as HTMLElement).closest('input,textarea,select,button:not([data-clip]),[contenteditable="true"]')) return;
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
  onDestroy(() => { gestureCancel?.(); analysisAbort?.abort(); clearTimeout(fxTimer); clearTimeout(importDismissTimer); ++playTimer; clearTimeout(timer); audio?.pause(); if (previewUrl) URL.revokeObjectURL(previewUrl); if (nextAudio) URL.revokeObjectURL(nextAudio.url); window.removeEventListener('online', online); window.removeEventListener('keydown', shortcut); });
</script>

<div class="flex h-full min-h-[620px] flex-col overflow-hidden bg-page" data-editor>
  <div class="flex h-12 flex-none items-center gap-3 border-b border-divider px-4">
    <a href={sessionsHref} class="text-[13px] text-text-2 hover:text-text">‹ Sessions</a>
    <div class="h-5 w-px bg-divider"></div>
    <div class="min-w-0 flex-1 truncate text-[14px]">{project.name}</div>
    <div class="flex items-center gap-2 text-[12px] text-text-2" aria-live="polite" data-save-state={saveState}>
      <span class:animate-pulse={saveState === 'saving'} class="size-1.5 rounded-full" class:bg-ok={saveState === 'saved'} class:bg-warn={saveState === 'saving' || saveState === 'offline'} class:bg-rec={saveState === 'failed' || saveState === 'conflict'}></span>
      {saveMessage}
    </div>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class="h-8 rounded-lg border border-border px-3 text-[12px]" aria-label="Editor tools">Tools {pendingRetakes ? `· ${pendingRetakes}` : ''}</DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-56">
        <DropdownMenu.Item data-retakes-open onclick={() => retakesOpen = true}>Review retakes {pendingRetakes ? `(${pendingRetakes})` : ''}</DropdownMenu.Item>
        <DropdownMenu.Item data-pauses-open onclick={() => pausesOpen = true}>Review pauses {project.pauses.length ? `(${project.pauses.length})` : ''}</DropdownMenu.Item>
        <DropdownMenu.Item onclick={() => { masterDraft = cleanMaster(plain(project.master)); loudnessOpen = true; }}>Loudness</DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item onclick={() => document.querySelector<HTMLInputElement>('[data-editor-import]')?.click()} disabled={importing}>Import audio</DropdownMenu.Item>
        {#if project.removedTracks?.length}
          <DropdownMenu.Separator />
          {#each project.removedTracks as track}<DropdownMenu.Item onclick={() => restoreTrack(track.id)}>Restore {track.name}</DropdownMenu.Item>{/each}
        {/if}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class="h-8 max-w-40 truncate rounded-lg border border-border px-3 text-[12px]" aria-label="Recorded session">{sessions.find((session) => session.id === project.takeId)?.name ?? 'Session'}</DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-56">
        {#each sessions as session}<DropdownMenu.Item onclick={() => void switchSession(session.id)}>{session.name}{session.id === project.takeId ? ' ✓' : ''}</DropdownMenu.Item>{/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    <input data-editor-import class="sr-only" type="file" accept="audio/*,.wav,.mp3,.m4a,.flac" disabled={importing} onchange={(e) => importFile(e.currentTarget.files?.[0])} />
    <Button data-export-open size="sm" onclick={() => exportOpen = true}>Export</Button>
  </div>
  {#if importStatus || importError}
    <div data-import-status class="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] right-4 z-40 w-[min(360px,calc(100vw-32px))] rounded-xl border border-border bg-surface p-4 text-[12px] text-text shadow-xl" role={importError ? 'alert' : 'status'} aria-live={importError ? 'assertive' : 'polite'}>
      <div class="flex items-start gap-3">
        <span class="mt-1 size-2 flex-none rounded-full" class:bg-rec={!!importError} class:bg-warn={importing && !importError} class:bg-ok={!importing && !importError}></span>
        <div class="min-w-0 flex-1"><strong class="block font-medium">{importError ? 'Audio import failed' : importing ? 'Adding audio' : 'Audio added'}</strong><span class="mt-1 block break-words text-text-2">{importError || importStatus}</span></div>
      </div>
      {#if importing && /Uploading… \d+%/.test(importStatus)}<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-track-off"><div class="h-full bg-primary transition-[width]" style={`width:${Number(importStatus.match(/(\d+)%/)?.[1] ?? 0)}%`}></div></div>{/if}
      {#if importError && pendingImport}<Button class="mt-3" variant="outline" size="sm" disabled={importing} onclick={() => importFile(pendingImport)}>Retry upload</Button>{/if}
    </div>
  {/if}
  <div class="flex min-h-0 flex-1 overflow-auto" data-timeline-scroll>
    <div class="relative min-w-full" style={`width:${HEADER + timelineWidth}px`}>
      <div class="sticky top-0 z-30 flex h-10 border-b border-divider bg-page/95 backdrop-blur">
        <div class="sticky left-0 z-40 flex w-[176px] flex-none items-center border-r border-divider bg-page px-4 text-[11px] font-mono text-text-3">TRACKS</div>
        <div class="relative flex-1" role="button" tabindex="0" aria-label="Timeline ruler" style={`width:${timelineWidth}px`} data-ruler onpointerdown={(e) => beginSelection(e)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') seek(playhead); }}>
          {#each Array(Math.ceil(duration / (zoom < 1 ? 30 : zoom > 3 ? 5 : 10)) + 1) as _, i}
            {@const step = zoom < 1 ? 30 : zoom > 3 ? 5 : 10}
            <div class="absolute top-0 h-full border-l border-divider" style={`left:${i * step * pxPerSecond}px`}><span class="ml-1.5 font-mono text-[10px] text-text-3">{fmt(i * step)}</span></div>
          {/each}
        </div>
      </div>
      <div class="sticky top-10 z-20 flex h-9 border-b border-divider bg-sheet">
        <div class="sticky left-0 z-30 flex w-[176px] flex-none items-center border-r border-divider bg-sheet px-4 text-[11px] text-text-3">MARKERS</div>
        <div class="relative" style={`width:${timelineWidth}px`}>
          {#each visibleMarkers as marker}
            {#if label(marker.kind)}<button class="absolute top-1 h-6 -translate-x-1/2 rounded-[4px] border border-border bg-control px-1.5 font-mono text-[9px] text-text-2 hover:text-text" style={`left:${marker.t * pxPerSecond}px`} onclick={() => seek(marker.t)} title={`${label(marker.kind)} · ${fmt(marker.t)}`}>{label(marker.kind)}</button>{/if}
          {/each}
        </div>
      </div>
      {#each project.tracks as track}
        {@const view = viewFor(track.id)}
        <div data-track={track.id} class="flex h-[104px] border-b border-divider" class:bg-surface={track.id === selectedTrack}>
          <div class="sticky left-0 z-20 flex w-[176px] flex-none flex-col justify-center gap-2 border-r border-divider bg-page px-3">
            <div class="flex items-center gap-2"><span class="size-2 rounded-full" style={`background:${view?.color ?? 'var(--color-text-3)'}`}></span><button class="min-w-0 flex-1 truncate text-left text-[12px] font-medium" onclick={() => selectedTrack = track.id} title={track.name}>{track.name}</button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger class="size-6 rounded-md text-text-2 hover:bg-control" aria-label={`${track.name} track actions`}>⋯</DropdownMenu.Trigger>
                <DropdownMenu.Content align="end" class="w-44">
                  {#if view?.status === 'error'}<DropdownMenu.Item onclick={() => { for (const clip of track.clips) void loadPeaks(track, clip.sourceStart, clip.sourceEnd); }}>Retry waveform</DropdownMenu.Item>{/if}
                  <DropdownMenu.Item variant="destructive" onclick={() => { removingTrack = track.id; removeOpen = true; }}>Remove track</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </div>
            <div class="flex items-center gap-1.5">
              <button class="size-7 rounded-[7px] border border-border text-[11px]" class:bg-text={track.muted} class:text-page={track.muted} onclick={() => toggleMute(track.id)} aria-label={`Mute ${track.name}`}>M</button>
              <button class="size-7 rounded-[7px] border border-border text-[11px]" class:bg-text={solo.includes(track.id)} class:text-page={solo.includes(track.id)} onclick={() => toggleSolo(track.id)} aria-label={`Solo ${track.name}`}>S</button>
              <button data-track-fx class="h-7 rounded-[7px] border border-border px-2 text-[11px]" onclick={() => { fxTrack = plain(track); fxBypass = false; fxPreviewing = false; }}>FX</button>
              <span class="ml-auto font-mono text-[10px] text-text-3">{track.gainDb > 0 ? '+' : ''}{track.gainDb} dB</span>
            </div>
            <input aria-label={`${track.name} level`} type="range" min="-24" max="12" step="1" value={track.gainDb} oninput={(e) => level(track.id, Number(e.currentTarget.value))} />
          </div>
          <div class="relative flex-1 overflow-hidden" role="region" aria-label={`${track.name} timeline`} style={`width:${timelineWidth}px`} data-lane tabindex="-1" onpointerdown={(e) => beginSelection(e, track)}>
            {#each track.clips as clip}
              {@const clipDuration = clip.sourceEnd - clip.sourceStart}
              {@const clipPeaks = waveformBars(view?.peaks ?? [], clip.sourceStart, clip.sourceEnd, pxPerSecond, clip.sourceStart + Math.max(0, visibleFrom - clip.timelineStart), clip.sourceStart + Math.min(clipDuration, visibleTo - clip.timelineStart))}
              <button data-clip class="absolute top-3 h-[78px] overflow-hidden rounded-[7px] border text-left" class:border-text={selectedClip === clip.id} class:border-border={selectedClip !== clip.id} class:opacity-40={track.muted} style={`left:${clip.timelineStart * pxPerSecond}px;width:${Math.max(4, clipDuration * pxPerSecond)}px;background:color-mix(in srgb, ${view?.color ?? 'var(--color-text-3)'} 12%, var(--color-surface))`} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectedTrack = track.id; selectedClip = clip.id; openClipPopover(e.currentTarget, clip); } }} title="Click for clip details; drag to move; Shift-drag to select time; Alt-drag to unlink" onpointerdown={(e) => dragClip(e, track, clip.id)}>
                <span role="slider" aria-label="Trim clip start" aria-valuemin={clip.sourceStart} aria-valuemax={clip.sourceEnd} aria-valuenow={clip.sourceStart} tabindex="0" class="absolute left-0 top-0 z-10 h-full w-2 cursor-ew-resize bg-text/20" onpointerdown={(e) => trim(e, track, clip.id, 'start')} onkeydown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); update(trimClip(plain(project), track.id, clip.id, 'start', e.key === 'ArrowRight' ? .01 : -.01)); } }}></span>
                <span role="slider" aria-label="Trim clip end" aria-valuemin={clip.sourceStart} aria-valuemax={clip.sourceEnd} aria-valuenow={clip.sourceEnd} tabindex="0" class="absolute right-0 top-0 z-10 h-full w-2 cursor-ew-resize bg-text/20" onpointerdown={(e) => trim(e, track, clip.id, 'end')} onkeydown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); update(trimClip(plain(project), track.id, clip.id, 'end', e.key === 'ArrowLeft' ? .01 : -.01)); } }}></span>
                <span class="absolute left-2 top-1 font-mono text-[9px] text-text-3">{clip.linked ? 'LINKED' : 'UNLINKED'}</span>
                {#if view?.status === 'loading' && !clipPeaks.length}<span class="absolute inset-0 flex items-center justify-center text-[11px] text-text-2">Preparing waveform…</span>{/if}
                {#if view?.status === 'error'}<span class="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] text-rec">Waveform unavailable · retry from track menu</span>{/if}
                <span class="absolute inset-x-0 bottom-2 top-5 opacity-80" aria-hidden="true">
                  {#each clipPeaks as bar}
                    <i data-waveform-peak class="absolute top-1/2 w-[2px] -translate-y-1/2 rounded-full" style={`left:${bar.left}px;height:${bar.height}px;background:${view?.color ?? 'var(--color-text-3)'}`}></i>
                  {/each}
                </span>
              </button>
            {/each}
            {#each project.crossfades?.filter((f) => f.trackId === track.id) ?? [] as fade}
              {@const span = crossfadeSpan(track, fade)}
              {#if span}<div data-crossfade class="pointer-events-none absolute top-3 h-[78px] border-x border-text/40 bg-text/5" style={`left:${span[0] * pxPerSecond}px;width:${(span[1] - span[0]) * pxPerSecond}px`} title="Equal-power crossfade"><svg class="h-full w-full" viewBox="0 0 100 78" preserveAspectRatio="none" aria-label="Crossfade"><path d="M0 0 Q64 0 100 78 M0 78 Q36 0 100 0" fill="none" stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke" opacity=".5" /></svg></div>{/if}
            {/each}
            {#if hasSelection}<div class="pointer-events-none absolute inset-y-0 bg-info/15 outline outline-1 outline-info" style={`left:${selection[0] * pxPerSecond}px;width:${(selection[1] - selection[0]) * pxPerSecond}px`}></div>{/if}
          </div>
        </div>
      {/each}
      <div class="pointer-events-none absolute bottom-0 top-0 z-40 w-px bg-rec" style={`left:${HEADER + playhead * pxPerSecond}px`}><span class="absolute -left-1.5 top-0 size-3 rotate-45 bg-rec"></span></div>
    </div>
  </div>
  <Popover.Root bind:open={clipPopoverOpen}>
    {#if selected && clipAnchor}
    <Popover.Content data-clip-popover customAnchor={clipAnchor} aria-label="Clip details" onInteractOutside={(e) => { if ((e.target as HTMLElement).closest('[data-clip]')) e.preventDefault(); }} onkeydown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); if (selected) clipDraft = { position: fmtPrecise(selected.timelineStart), start: fmtPrecise(selected.sourceStart), end: fmtPrecise(selected.sourceEnd) }; clipPopoverOpen = false; } }}>
      <div class="mb-3 flex items-center justify-between"><strong>Clip details</strong><button aria-label="Close clip details" class="rounded px-1 text-text-2 hover:text-text" onclick={() => clipPopoverOpen = false}>×</button></div>
      {#each [{ key: 'position', name: 'Timeline position' }, { key: 'start', name: 'Source in' }, { key: 'end', name: 'Source out' }] as field}
        <label class="mb-2 flex items-center justify-between gap-3 text-text-2">{field.name}<Input class="w-28 font-mono text-right text-text" aria-label={field.name} type="text" value={clipDraft[field.key as 'position' | 'start' | 'end']} oninput={(e) => clipDraft[field.key as 'position' | 'start' | 'end'] = e.currentTarget.value} onchange={() => commitClipField(field.key as 'position' | 'start' | 'end')} onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></label>
      {/each}
      {#if clipInputError}<p role="alert" class="text-rec">{clipInputError}</p>{/if}
      <p class="mt-2 text-[11px] text-text-3">Times are minutes:seconds.milliseconds.</p>
    </Popover.Content>
    {/if}
  </Popover.Root>
  <div class="flex min-h-[56px] flex-none items-center gap-3 border-t border-divider bg-surface px-4 py-2">
    <button data-editor-play class="size-9 rounded-full bg-text text-page disabled:opacity-60" disabled={loadingAudio} onclick={() => playing ? pause() : void play()} title={playing ? 'Pause (Space)' : 'Play (Space)'} aria-label={playing ? 'Pause' : 'Play'}><svg class="mx-auto size-5" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">{#if playing}<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>{:else}<path d="M7 4L21 12L7 20Z"/>{/if}</svg></button>
    <button class="size-9 rounded-[10px] border border-border text-[12px]" onclick={stop} aria-label="Stop" title="Stop"><svg class="mx-auto size-5" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="1"/></svg></button>
    <span class="w-[58px] font-mono text-[12px]">{fmt(playhead)}</span>
    <input class="min-w-[160px] flex-1" aria-label="Playhead" type="range" min="0" max={Math.max(.01, duration)} step=".01" value={playhead} oninput={(e) => seek(Number(e.currentTarget.value))} />
    <span class="font-mono text-[12px] text-text-2">{fmt(duration)}</span>
    <div class="h-6 w-px bg-divider"></div>
    <DropdownMenu.Root bind:open={editMenuOpen}>
      <DropdownMenu.Trigger class="h-8 rounded-lg border border-border px-3 text-[12px]" aria-label="Edit actions">Edit</DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-44">
        <DropdownMenu.Item disabled={!history.length} onclick={() => { editMenuOpen = false; undo(); }}>Undo</DropdownMenu.Item>
        <DropdownMenu.Item disabled={!future.length} onclick={() => { editMenuOpen = false; redo(); }}>Redo</DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item onclick={() => { editMenuOpen = false; split(); }}>Split</DropdownMenu.Item>
        <DropdownMenu.Item disabled={!selectedClip} onclick={() => { editMenuOpen = false; unlinkSelected(); }}>{selected?.linked === false ? 'Link' : 'Unlink'}</DropdownMenu.Item>
        <DropdownMenu.Item disabled={!hasSelection && !selectedClip} onclick={() => { editMenuOpen = false; remove(false); }}>Delete</DropdownMenu.Item>
        <DropdownMenu.Item disabled={!hasSelection} onclick={() => { editMenuOpen = false; remove(true); }}>Ripple cut</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    <span class="text-[11px] text-text-3">Zoom</span><Slider type="single" class="w-24" aria-label="Timeline zoom" min={0.5} max={6} step={0.5} bind:value={zoom} />
    {#if loadingAudio || playbackStatus}<span role="status" data-playback-status class="text-[11px] text-text-2" aria-live="polite">{playbackStatus || 'Preparing audio…'}</span>{/if}
    {#if playbackError}<button data-playback-error class="max-w-40 truncate text-[11px] text-rec underline" title={playbackError} onclick={() => void play()}>{playbackError} · Retry</button>{/if}
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
        <button class="mt-3 h-9 rounded-[9px] bg-primary px-3 text-[12px] text-primary-fg" onclick={() => reviewRetake(retake.id, retake.attempts.at(-1)!.id)}>Keep last take</button>
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

<Sheet open={!!fxTrack} labelledby="fx-title" onclose={closeFx}>
  {#snippet header()}<div><h2 id="fx-title" class="text-[18px]">{fxTrack?.name} FX</h2><p class="mt-1 text-[13px] text-text-2">Preview changes in the mix before applying.</p></div>{/snippet}
  {#if fxTrack}<EditorFxControls bind:fx={fxTrack.fx} voice={fxTrack.kind === 'voice'} />{/if}
  {#snippet footer()}<div class="flex items-center gap-3"><button class="h-9 rounded-[9px] border border-border px-3 text-[13px]" onclick={() => { fxPreviewing = !fxPreviewing; if (!fxPreviewing) pause(); else { invalidateAudio(); void loadWindow(playhead, true); } }}>{fxPreviewing ? 'Stop preview' : 'Preview FX'}</button><label class="text-[12px]">Bypass<input class="ml-2" type="checkbox" bind:checked={fxBypass} /></label><div class="flex-1"></div><button class="h-9 rounded-[9px] border border-border px-3 text-[13px]" onclick={closeFx}>Cancel</button><button class="h-9 rounded-[9px] bg-primary px-4 text-[13px] text-primary-fg" onclick={saveFx}>Apply FX</button></div>{/snippet}
</Sheet>

<Sheet open={loudnessOpen} labelledby="loudness-title" onclose={closeLoudness}>
  {#snippet header()}<div><h2 id="loudness-title" class="text-[18px]">Finished mix loudness</h2><p class="mt-1 text-[13px] text-text-2">Measure the whole mix before comparing mastered playback.</p></div>{/snippet}
  <div class="flex flex-col gap-5">
    <label class="text-[13px]">Target<select class="mt-2 h-10 w-full rounded-[10px] border border-border bg-page px-3" bind:value={masterDraft.loudness}><option value="stereo">Podcast stereo · −16 LUFS</option><option value="mono">Podcast mono · −19 LUFS</option><option value="custom">Custom</option><option value="off">Normalization off</option></select></label>
    {#if masterDraft.loudness === 'custom'}<label class="text-[13px]">Target LUFS<input class="ml-3 h-10 rounded-[10px] border border-border bg-page px-3 font-mono" type="number" min="-30" max="-10" step=".5" bind:value={masterDraft.targetLufs} /></label>{/if}
    {#if masterDraft.loudness === 'custom' || masterDraft.loudness === 'off'}<label class="text-[13px]">Output<select class="ml-3 h-10 rounded-[10px] border border-border bg-page px-3" bind:value={masterDraft.channels}><option value={2}>Stereo</option><option value={1}>Mono</option></select></label>{/if}
    <label class="text-[13px]">True-peak ceiling <span class="text-text-3">dBTP</span><input class="ml-3 h-10 rounded-[10px] border border-border bg-page px-3 font-mono" type="number" min="-3" max="-.1" step=".1" bind:value={masterDraft.ceilingDb} /></label>
    <div class="rounded-[14px] bg-surface p-4 text-[13px]" aria-live="polite">{#if measurement}<div class="mb-3 text-text-2">{measurementStale ? 'Measurements are stale · analyze again' : 'Current finished mix'}</div><div class="grid grid-cols-3 gap-4 font-mono"><span>{Number.isFinite(measurement.result) ? measurement.result.toFixed(1) : '—'} LUFS</span><span>{measurement.range?.toFixed(1) ?? '—'} LU</span><span>{measurement.truePeak.toFixed(1)} dBTP</span></div>{/if}<p class="mt-3 text-text-2">{analysisStatus || 'Analyze to measure integrated loudness, range, and true peak.'}</p></div>
    <div class="flex gap-3"><button class="h-9 rounded-[10px] border border-border px-3 text-[13px]" disabled={analyzing} onclick={analyze}>Analyze mix</button>{#if analyzing}<button class="text-[13px]" onclick={() => analysisAbort?.abort()}>Cancel analysis</button>{/if}</div>
    <label class="text-[13px]">Listen to mastered mix <input class="ml-2" type="checkbox" bind:checked={mastered} onchange={() => { solo = []; if (mastered) { update({ ...plain(project), master: cleanMaster(plain(masterDraft)) }); } else refreshAudio(); }} /></label>
    <p class="help">Mastered playback uses the full mix and the same processing as export. Raw tracks stay unchanged.</p>
  </div>
  {#snippet footer()}<div class="flex justify-end gap-3"><button class="h-9 rounded-[10px] border border-border px-3 text-[13px]" onclick={closeLoudness}>Close</button><button class="h-9 rounded-[10px] bg-primary px-3 text-[13px] text-primary-fg" onclick={applyMaster}>Apply loudness</button></div>{/snippet}
</Sheet>

<Sheet bind:open={exportOpen} labelledby="export-title" onclose={() => { completed = null; exportStatus = ''; }}>
  {#snippet header()}<div><h2 id="export-title" class="text-[18px]">Export episode</h2><p class="mt-1 text-[13px] text-text-2">The finished WAV includes every reviewed edit and track setting.</p></div>{/snippet}
  {#if completed}<div class="py-8 text-center" data-export-complete><div class="mx-auto mb-4 flex size-10 items-center justify-center rounded-full bg-ok/15 text-ok">✓</div><h3 class="text-[17px]">Your export is ready</h3><p class="mt-2 text-[13px] text-text-2">{completed.filename}</p><div class="mt-5 flex justify-center gap-2"><a class="flex h-9 items-center rounded-[9px] bg-primary px-3 text-[13px] text-primary-fg" href={sessionsHref}>Back to sessions</a><button class="h-9 rounded-[9px] border border-border px-3 text-[13px]" onclick={completed.downloadAgain}>Download again</button></div><div class="mt-8 rounded-[12px] border border-dashed border-border p-4 text-left opacity-50"><div class="text-[13px]">Optional AI tools</div><div class="mt-1 text-[12px] text-text-3">Coming soon</div></div></div>
  {:else}<div class="flex flex-col gap-3">
    <label class="flex items-center justify-between rounded-[12px] bg-surface p-4 text-[13px]">Finished WAV <input type="checkbox" checked disabled /></label>
    <label class="flex items-center justify-between rounded-[12px] bg-surface p-4 text-[13px]">Also make MP3 <input type="checkbox" bind:checked={project.master.mp3} onchange={queueSave} /></label>
    <label class="flex items-center justify-between rounded-[12px] bg-surface p-4 text-[13px]">Include raw tracks <input type="checkbox" bind:checked={project.master.rawTracks} onchange={queueSave} /></label>
    {#if pendingRetakes}<p class="rounded-[10px] bg-warn/10 p-3 text-[12px] text-warn">Review every retake group before exporting the finished mix.</p>{/if}
    {#if exportStatus}<p class="text-[12px] text-text-2" aria-live="polite">{exportStatus}</p>{/if}
  </div>{/if}
  {#snippet footer()}{#if !completed}<div class="flex justify-end gap-2"><button class="h-9 rounded-[9px] border border-border px-3 text-[13px]" onclick={() => exportOpen = false}>Cancel</button><button class="h-9 rounded-[9px] bg-primary px-4 text-[13px] text-primary-fg disabled:opacity-40" disabled={exporting || !!pendingRetakes} onclick={runExport}>{exporting ? 'Exporting…' : 'Export'}</button></div>{/if}{/snippet}
</Sheet>

<Sheet open={!!conflict} labelledby="conflict-title">
  {#snippet header()}<div><h2 id="conflict-title" class="text-[18px]">Project changed elsewhere</h2><p class="mt-1 text-[13px] text-text-2">Autosave is paused so neither version is overwritten.</p></div>{/snippet}
  <p class="text-[13px] leading-relaxed text-text-2">Load the server version, or keep this browser’s edits and overwrite it.</p>
  {#snippet footer()}<div class="flex justify-end gap-2"><button class="h-9 rounded-[9px] border border-border px-3 text-[13px]" onclick={reloadConflict}>Reload server version</button><button class="h-9 rounded-[9px] bg-primary px-4 text-[13px] text-primary-fg" onclick={overwriteConflict}>Overwrite with this version</button></div>{/snippet}
</Sheet>

<AlertDialog.Root bind:open={removeOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Remove track?</AlertDialog.Title>
      <AlertDialog.Description>{project.tracks.find((track) => track.id === removingTrack)?.name ?? 'This track'} will leave the timeline and finished mix. Its source audio remains available to restore.</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel onclick={() => removingTrack = null}>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action variant="destructive" class="border border-rec bg-transparent text-rec hover:bg-rec/10 dark:bg-transparent dark:hover:bg-rec/10" onclick={confirmRemoveTrack}>Remove track</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<style>
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--color-text); outline-offset: 3px; }
  [data-clip] { touch-action: none; user-select: none; }
</style>
