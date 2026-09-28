import type { SessionMarker, LineStart } from './audio/assemble.ts';
import { cleanTone, COMP_PRESETS, flatTone, type VoiceTone } from './audio/tone.ts';

export type EditorTrackKind = 'voice' | 'pads' | 'import';
export type CompressionPreset = 'Off' | 'Light' | 'Medium' | 'Heavy';

export interface EditorFx {
  noise: number;
  low: number;
  mid: number;
  high: number;
  compression: CompressionPreset;
  level: boolean;
}

export interface EditorClip {
  id: string;
  sourceId: string;
  sourceStart: number;
  sourceEnd: number;
  timelineStart: number;
  linked: boolean;
  fadeInMs: number;
  fadeOutMs: number;
}

export interface EditorTrack {
  id: string;
  sourceId: string;
  kind: EditorTrackKind;
  role?: 'host' | 'guest';
  name: string;
  channels: 1 | 2;
  sampleRate: number;
  gainDb: number;
  muted: boolean;
  fx: EditorFx;
  clips: EditorClip[];
}

export interface EditorAttempt {
  id: string;
  number: number;
  start: number;
  end: number;
}

export interface EditorRetake {
  id: string;
  line: number;
  attempts: EditorAttempt[];
  selected: string;
  reviewed: boolean;
  trimStart: number;
  trimEnd: number;
}

export interface EditorPause {
  id: string;
  start: number;
  end: number;
  source: 'marker' | 'detected';
  action: 'keep' | 'shorten' | 'remove';
  keepSeconds: number;
}

export interface EditorMaster {
  loudness: 'stereo' | 'mono' | 'off';
  mp3: boolean;
  rawTracks: boolean;
}

export interface EditorProjectV1 {
  version: 1;
  takeId: string;
  episodeId: string;
  name: string;
  tracks: EditorTrack[];
  markers: SessionMarker[];
  retakes: EditorRetake[];
  pauses: EditorPause[];
  master: EditorMaster;
  updatedAt: number;
}

export interface EditorSource {
  id: string;
  kind: EditorTrackKind;
  role?: 'host' | 'guest';
  name: string;
  duration: number;
  channels: 1 | 2;
  sampleRate: number;
}

export const defaultFx = (voice = true): EditorFx => ({ noise: voice ? 0 : 0, low: 0, mid: 0, high: 0, compression: 'Off', level: false });

const uid = (prefix: string, ...parts: (string | number)[]) => `${prefix}-${parts.join('-')}`.replace(/[^A-Za-z0-9_-]/g, '-');
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : lo));

export function deriveRetakes(markers: SessionMarker[], lineLog: LineStart[], duration: number): EditorRetake[] {
  const lines = [...new Set(markers.filter((m) => m.kind === 'retake').map((m) => m.line))];
  return lines.map((line) => {
    const starts = lineLog.filter((s) => s.line === line).map((s) => s.t).sort((a, b) => a - b);
    const marks = markers.filter((m) => m.kind === 'retake' && m.line === line).sort((a, b) => a.t - b.t);
    const attemptStarts = [...new Set([...starts, ...marks.map((m) => m.t)])].sort((a, b) => a - b);
    const nextLine = lineLog.filter((s) => s.line !== line && s.t > attemptStarts.at(-1)!).sort((a, b) => a.t - b.t)[0]?.t ?? duration;
    const attempts = attemptStarts.map((start, i) => ({
      id: uid('attempt', line, i + 1),
      number: i + 1,
      start,
      end: Math.max(start, i + 1 < attemptStarts.length ? attemptStarts[i + 1] : nextLine),
    }));
    const selected = attempts.at(-1)!;
    return {
      id: uid('retake', line),
      line,
      attempts,
      selected: selected.id,
      reviewed: false,
      trimStart: selected.start,
      trimEnd: selected.end,
    };
  });
}

export function createEditorProject(input: {
  takeId: string;
  episodeId: string;
  name: string;
  sources: EditorSource[];
  markers?: SessionMarker[];
  lineLog?: LineStart[];
  loudness?: EditorMaster['loudness'];
  noise?: number;
  tones?: Record<string, VoiceTone>;
  level?: boolean;
}): EditorProjectV1 {
  const markers = structuredClone(input.markers ?? []);
  const duration = Math.max(0, ...input.sources.map((s) => s.duration));
  const tracks = input.sources.map((s) => {
    const remembered = input.tones?.[s.name.toUpperCase()];
    const tone = cleanTone(remembered);
    const fx = fxFromTone(tone, s.kind === 'voice' ? (input.noise ?? 0) : 0, s.kind === 'voice' && !!input.level);
    return {
      id: uid('track', s.id), sourceId: s.id, kind: s.kind, role: s.role, name: s.name,
      channels: s.channels, sampleRate: s.sampleRate, gainDb: 0, muted: false, fx,
      clips: [{ id: uid('clip', s.id, 0), sourceId: s.id, sourceStart: 0, sourceEnd: s.duration, timelineStart: 0, linked: true, fadeInMs: 0, fadeOutMs: 0 }],
    } satisfies EditorTrack;
  });
  const pauses = markers.filter((m) => m.kind === 'pause' && m.end != null && m.end > m.t).map((m, i) => ({
    id: uid('pause', i, Math.round(m.t * 1000)), start: m.t, end: m.end!, source: 'marker' as const, action: 'keep' as const, keepSeconds: 1,
  }));
  return {
    version: 1, takeId: input.takeId, episodeId: input.episodeId, name: input.name, tracks, markers,
    retakes: deriveRetakes(markers, input.lineLog ?? [], duration), pauses,
    master: { loudness: input.loudness ?? 'stereo', mp3: false, rawTracks: false }, updatedAt: Date.now(),
  };
}

/** Map the simple Low/Mid/High UI to the existing ten-band export processor. */
export function toneFromFx(fx: EditorFx): VoiceTone {
  const tone = flatTone();
  tone.eq.on = fx.low !== 0 || fx.mid !== 0 || fx.high !== 0;
  tone.eq.gains = [fx.low, fx.low, fx.low, fx.mid, fx.mid, fx.mid, fx.high, fx.high, fx.high, fx.high];
  tone.eq.preset = null;
  if (fx.compression !== 'Off') {
    tone.comp = { on: true, ...COMP_PRESETS[fx.compression], preset: fx.compression };
  }
  return tone;
}

export function fxFromTone(tone: VoiceTone, noise = 0, level = false): EditorFx {
  const avg = (xs: number[]) => Math.round(xs.reduce((n, x) => n + x, 0) / Math.max(1, xs.length));
  return {
    noise: clamp(noise, 0, 100), low: avg(tone.eq.gains.slice(0, 3)), mid: avg(tone.eq.gains.slice(3, 6)), high: avg(tone.eq.gains.slice(6)),
    compression: tone.comp.on && ['Light', 'Medium', 'Heavy'].includes(tone.comp.preset ?? '') ? (tone.comp.preset as CompressionPreset) : tone.comp.on ? 'Medium' : 'Off', level,
  };
}

export function projectDuration(project: EditorProjectV1): number {
  return Math.max(0, ...project.tracks.flatMap((t) => t.clips.map((c) => c.timelineStart + c.sourceEnd - c.sourceStart)));
}

/** Candidate pauses from half-second peak buckets. A suggestion is metadata only. */
export function detectPauses(peaks: number[][], secondsPerPeak = 0.5, minimum = 3, threshold = 0.01): EditorPause[] {
  if (!peaks.length) return [];
  const length = Math.max(...peaks.map((x) => x.length));
  const quiet = (i: number) => peaks.every((track) => (track[i] ?? 0) < threshold);
  const out: EditorPause[] = [];
  let began = -1;
  for (let i = 0; i <= length; i++) {
    if (i < length && quiet(i)) {
      if (began < 0) began = i;
      continue;
    }
    if (began >= 0 && (i - began) * secondsPerPeak >= minimum) {
      const start = began * secondsPerPeak, end = i * secondsPerPeak;
      out.push({ id: uid('silence', Math.round(start * 1000)), start, end, source: 'detected', action: 'keep', keepSeconds: 1 });
    }
    began = -1;
  }
  return out;
}

const splitClip = (clip: EditorClip, at: number): EditorClip[] => {
  const end = clip.timelineStart + clip.sourceEnd - clip.sourceStart;
  if (at <= clip.timelineStart || at >= end) return [clip];
  const sourceAt = clip.sourceStart + at - clip.timelineStart;
  return [
    { ...clip, id: `${clip.id}-a`, sourceEnd: sourceAt, fadeOutMs: 0 },
    { ...clip, id: `${clip.id}-b`, sourceStart: sourceAt, timelineStart: at, fadeInMs: 0 },
  ];
};

export function splitProject(project: EditorProjectV1, at: number, trackId?: string): EditorProjectV1 {
  const p = structuredClone(project);
  for (const track of p.tracks) if (!trackId || track.id === trackId || track.clips.some((c) => c.linked)) track.clips = track.clips.flatMap((c) => splitClip(c, at));
  p.updatedAt = Date.now();
  return p;
}

function removeFromClip(clip: EditorClip, start: number, end: number): EditorClip[] {
  const clipEnd = clip.timelineStart + clip.sourceEnd - clip.sourceStart;
  if (end <= clip.timelineStart || start >= clipEnd) return [clip];
  const out: EditorClip[] = [];
  if (start > clip.timelineStart) out.push({ ...clip, id: `${clip.id}-l`, sourceEnd: clip.sourceStart + start - clip.timelineStart, fadeOutMs: 10 });
  if (end < clipEnd) out.push({ ...clip, id: `${clip.id}-r`, sourceStart: clip.sourceStart + end - clip.timelineStart, timelineStart: end, fadeInMs: 10 });
  return out;
}

export function deleteRange(project: EditorProjectV1, start: number, end: number, ripple: boolean, trackId?: string): EditorProjectV1 {
  const p = structuredClone(project);
  start = Math.max(0, Math.min(start, end)); end = Math.max(start, end);
  const amount = end - start;
  for (const track of p.tracks) {
    const linked = track.clips.some((c) => c.linked);
    if (trackId && track.id !== trackId && !linked) continue;
    track.clips = track.clips.flatMap((c) => removeFromClip(c, start, end));
    if (ripple && amount) for (const clip of track.clips) if (clip.timelineStart >= end) clip.timelineStart -= amount;
  }
  if (ripple && amount) {
    const shift = (t: number) => (t <= start ? t : t >= end ? t - amount : start);
    p.markers = p.markers.map((m) => ({ ...m, t: shift(m.t), ...(m.end != null ? { end: shift(m.end) } : {}) }));
    p.pauses = p.pauses.map((x) => ({ ...x, start: shift(x.start), end: shift(x.end) })).filter((x) => x.end > x.start);
  }
  p.updatedAt = Date.now();
  return p;
}

export function moveClip(project: EditorProjectV1, trackId: string, clipId: string, timelineStart: number, unlink = false): EditorProjectV1 {
  const p = structuredClone(project);
  const track = p.tracks.find((t) => t.id === trackId);
  const clip = track?.clips.find((c) => c.id === clipId);
  if (!clip) return p;
  const originalStart = clip.timelineStart;
  const delta = Math.max(0, timelineStart) - originalStart;
  if (unlink) clip.linked = false;
  for (const t of p.tracks) for (const c of t.clips) if (c.id === clipId || (!unlink && clip.linked && c.linked && Math.abs(c.timelineStart - originalStart) < 1e-6)) c.timelineStart = Math.max(0, c.timelineStart + delta);
  p.updatedAt = Date.now();
  return p;
}

export function trimClip(project: EditorProjectV1, trackId: string, clipId: string, edge: 'start' | 'end', seconds: number): EditorProjectV1 {
  const p = structuredClone(project);
  const clip = p.tracks.find((t) => t.id === trackId)?.clips.find((c) => c.id === clipId);
  if (!clip) return p;
  const originalStart = clip.timelineStart;
  for (const track of p.tracks) for (const candidate of track.clips) {
    if (candidate.id !== clipId && !(clip.linked && candidate.linked && Math.abs(candidate.timelineStart - originalStart) < 1e-6)) continue;
    const next = clamp(seconds, 0, candidate.sourceEnd - candidate.sourceStart - 0.01);
    if (edge === 'start') {
      candidate.sourceStart += next;
      candidate.timelineStart += next;
    } else candidate.sourceEnd -= next;
  }
  p.updatedAt = Date.now();
  return p;
}

export function cleanEditorProject(value: unknown): EditorProjectV1 | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as EditorProjectV1;
  if (p.version !== 1 || typeof p.takeId !== 'string' || typeof p.episodeId !== 'string' || !Array.isArray(p.tracks) || p.tracks.length > 64) return null;
  if (p.tracks.some((t) => !t || typeof t.id !== 'string' || typeof t.sourceId !== 'string' || !['voice', 'pads', 'import'].includes(t.kind) || !Array.isArray(t.clips) || t.clips.length > 10_000)) return null;
  if (p.tracks.some((t) => t.clips.some((c) => !c || typeof c.id !== 'string' || typeof c.sourceId !== 'string' || ![c.sourceStart, c.sourceEnd, c.timelineStart].every(Number.isFinite) || c.sourceStart < 0 || c.sourceEnd <= c.sourceStart || c.timelineStart < 0))) return null;
  const copy = structuredClone(p);
  copy.tracks = copy.tracks.map((t) => ({ ...t, gainDb: clamp(t.gainDb, -60, 12), muted: !!t.muted, fx: { ...defaultFx(t.kind === 'voice'), ...t.fx }, clips: Array.isArray(t.clips) ? t.clips : [] }));
  copy.markers = Array.isArray(copy.markers) ? copy.markers : [];
  copy.retakes = Array.isArray(copy.retakes) ? copy.retakes : [];
  copy.pauses = Array.isArray(copy.pauses) ? copy.pauses : [];
  copy.master = { loudness: copy.master?.loudness ?? 'stereo', mp3: !!copy.master?.mp3, rawTracks: !!copy.master?.rawTracks };
  return copy;
}
