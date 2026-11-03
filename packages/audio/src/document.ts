// The application-owned project document (BUILD_PLAN "Recording and project contracts").
// Independent of any timeline library: it is plain JSON, positions are integer samples,
// sources are immutable, and every edit is a pure function returning a new document or an
// error. The browser editor, the server (validation, revisions) and the worker's WAV render
// all read this one shape.
//
// Clock: one project sample rate (`sampleRate`); a clip's `srcStart`/`length` are source
// samples, its `start` is the timeline position — both at that rate. Only sources recorded
// at the project rate are accepted until the import stage brings a resampling pipeline.

import { normalizeFx, type TrackFx } from "./fx";
import { isDeliveryPreset, type DeliveryPreset } from "./delivery";

export const PROJECT_SCHEMA_VERSION = 1;

export type TrackKind = "host" | "guest" | "music" | "sfx";
export const TRACK_KINDS: readonly TrackKind[] = ["host", "guest", "music", "sfx"];
export const TRACK_HEIGHT = { min: 64, max: 260, default: 96 } as const;
export const GAIN_DB = { min: -60, max: 24 } as const;

export interface Source {
  id: string;
  /** `assets.id` of the immutable audio file. */
  assetId: string;
  /** `recordings.id` when the source is a Podstudio recording (its annotations anchor here). */
  recordingId?: string;
  label: string;
  /** Frames (samples per channel). */
  totalSamples: number;
  /** 1 (mono, default) or 2 (stereo, interleaved L/R in the WAV). */
  channels?: 1 | 2;
}

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  height: number;
  /** Custom colour (`#rrggbb`). Absent = the colour for the track's kind. */
  color?: string;
  /** Track volume (the fader), dB. Absent = 0 dB. Applied after clip gain/fades; FX will sit before it. */
  gainDb?: number;
  /**
   * Pan, −1 (left) … 0 (centre) … +1 (right). Absent = 0. A balance law: the centre is 0 dB on both
   * sides (so a centred mono track mixes exactly like a mono mix), panning turns the far side down.
   */
  pan?: number;
  /** Track FX (noise reduction, filters, EQ, compressor) — see fx.ts. Absent = none. */
  fx?: TrackFx;
}

/** Left/right gains for a pan position (balance law). */
export const panGains = (pan: number | undefined): [number, number] => {
  const p = Math.max(-1, Math.min(1, pan ?? 0));
  return [Math.min(1, 1 - p), Math.min(1, 1 + p)];
};
export const sourceChannels = (s: Pick<Source, "channels">): 1 | 2 => (s.channels === 2 ? 2 : 1);

export const TRACK_GAIN_DB = { min: -60, max: 12 } as const;

/** Colour presets offered in the editor; any `#rrggbb` is accepted. */
/** Track color choices (Tyler's base palette, 2026-11-02). Black is drawn as bone on the dark timeline. */
export const TRACK_COLOR_PRESETS = ["#000000", "#fabf47", "#00fff5", "#beff00", "#ff807f", "#c7bff6"] as const;
const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

export interface Clip {
  id: string;
  trackId: string;
  sourceId: string;
  /** First source sample used. */
  srcStart: number;
  /** Samples used (> 0). */
  length: number;
  /** Timeline position of the clip's first sample. */
  start: number;
  gainDb: number;
  fadeIn: number;
  fadeOut: number;
}

/** A mark anchored to a *source* sample, so it follows the audio through cuts and moves. */
export interface Annotation {
  id: string;
  kind: "retake" | "chapter";
  sourceId: string;
  sample: number;
  label: string;
}

/**
 * Ducking: lower some tracks (music, SFX…) while other tracks are playing (usually voices).
 * `triggers: "speech"` means every host and guest track; otherwise an explicit list of track ids.
 */
export interface DuckRule {
  id: string;
  enabled: boolean;
  /** Tracks that get turned down. */
  targets: string[];
  triggers: "speech" | string[];
  /** How far the targets drop while triggered (−40…0 dB). */
  amountDb: number;
  /** Trigger level above which ducking starts (−70…−10 dBFS). */
  thresholdDb: number;
  attackMs: number;
  releaseMs: number;
}

export const DUCK = {
  amountDb: { min: -40, max: 0, default: -12 },
  thresholdDb: { min: -70, max: -10, default: -42 },
  attackMs: { min: 1, max: 500, default: 60 },
  releaseMs: { min: 20, max: 3000, default: 450 },
  maxRules: 8,
} as const;

export interface ProjectDoc {
  schemaVersion: number;
  sampleRate: number;
  sources: Source[];
  tracks: Track[];
  clips: Clip[];
  annotations: Annotation[];
  /** Absent in projects made before ducking existed. */
  ducking?: DuckRule[];
  /** This episode's delivery preset; absent = the show's default. */
  delivery?: { preset: DeliveryPreset };
}

export type EditError = { ok: false; error: string };
export type EditResult = { ok: true; doc: ProjectDoc } | EditError;
const fail = (error: string): EditError => ({ ok: false, error });
const ok = (doc: ProjectDoc): EditResult => ({ ok: true, doc });

export const newId = () => crypto.randomUUID();

export const clipEnd = (c: Clip) => c.start + c.length;

export function clipsOnTrack(doc: ProjectDoc, trackId: string): Clip[] {
  return doc.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
}

/** Timeline length: the end of the last clip. */
export function projectLength(doc: ProjectDoc): number {
  let max = 0;
  for (const c of doc.clips) max = Math.max(max, clipEnd(c));
  return max;
}

const track = (doc: ProjectDoc, id: string) => doc.tracks.find((t) => t.id === id);
const clip = (doc: ProjectDoc, id: string) => doc.clips.find((c) => c.id === id);
const isInt = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);

// ---- creation --------------------------------------------------------------------------

export interface SourceInput extends Source {
  /** Retake marks (capture-clock samples) to carry in as annotations. */
  retakes?: number[];
}

/** A new project with one host track holding the whole recording, retakes as annotations. */
export function createProject(input: { sampleRate: number; source: SourceInput; trackName?: string }): ProjectDoc {
  const { source } = input;
  const tr: Track = { id: newId(), name: input.trackName ?? "Host", kind: "host", muted: false, solo: false, locked: false, height: TRACK_HEIGHT.default };
  const { retakes, ...src } = source;
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    sampleRate: input.sampleRate,
    sources: [src],
    tracks: [tr],
    clips: [{ id: newId(), trackId: tr.id, sourceId: src.id, srcStart: 0, length: src.totalSamples, start: 0, gainDb: 0, fadeIn: 0, fadeOut: 0 }],
    annotations: (retakes ?? [])
      .filter((s) => isInt(s) && s >= 0 && s < src.totalSamples)
      .sort((a, b) => a - b)
      .map((sample, i) => ({ id: newId(), kind: "retake" as const, sourceId: src.id, sample, label: `Retake ${i + 1}` })),
  };
}

// ---- clip edits ------------------------------------------------------------------------

function editable(doc: ProjectDoc, trackId: string): EditError | null {
  const t = track(doc, trackId);
  if (!t) return fail("No such track.");
  if (t.locked) return fail(`Track "${t.name}" is locked.`);
  return null;
}

const replaceClips = (doc: ProjectDoc, clips: Clip[]): ProjectDoc => ({ ...doc, clips });

/** Split the clip under `at` (a timeline sample strictly inside it) into two. */
export function splitClip(doc: ProjectDoc, clipId: string, at: number): EditResult {
  const c = clip(doc, clipId);
  if (!c) return fail("No such clip.");
  const locked = editable(doc, c.trackId);
  if (locked) return locked;
  if (!isInt(at) || at <= c.start || at >= clipEnd(c)) return fail("The split point has to be inside the clip.");
  const cut = at - c.start;
  const left: Clip = { ...c, length: cut, fadeOut: 0 };
  const right: Clip = { ...c, id: newId(), srcStart: c.srcStart + cut, length: c.length - cut, start: at, fadeIn: 0 };
  return ok(replaceClips(doc, doc.clips.flatMap((x) => (x.id === c.id ? [left, right] : [x]))));
}

/** Split every unlocked clip under `at` — the visible "Split" command. */
export function splitAt(doc: ProjectDoc, at: number, trackIds?: string[]): EditResult {
  let cur = doc;
  let n = 0;
  for (const c of doc.clips) {
    if (trackIds && !trackIds.includes(c.trackId)) continue;
    if (track(doc, c.trackId)?.locked) continue;
    if (at > c.start && at < clipEnd(c)) {
      const r = splitClip(cur, c.id, at);
      if (!r.ok) return r;
      cur = r.doc;
      n++;
    }
  }
  return n ? ok(cur) : fail("Nothing to split at the playhead.");
}

function overlaps(clips: Clip[], c: { id: string; start: number; length: number }): boolean {
  return clips.some((o) => o.id !== c.id && o.start < c.start + c.length && c.start < clipEnd(o));
}

/**
 * Crossfades: two clips on a track may overlap, and the overlap is a crossfade (the earlier clip
 * fades out across it while the later one fades in). Never three at once, and one clip can't sit
 * inside another. Returns why a track's layout is not allowed, or null when it is.
 */
export function layoutProblem(clips: Clip[]): string | null {
  const cs = [...clips].sort((a, b) => a.start - b.start || clipEnd(a) - clipEnd(b));
  for (let i = 1; i < cs.length; i++) {
    const a = cs[i - 1]!;
    const b = cs[i]!;
    if (b.start < clipEnd(a) && (b.start === a.start || clipEnd(b) <= clipEnd(a))) return "A clip can't sit entirely over another one.";
    if (i >= 2 && b.start < clipEnd(cs[i - 2]!)) return "Only two clips can overlap (crossfade) at a time.";
  }
  return null;
}

/** Clips with their fades widened to cover crossfades (overlaps with neighbours on the same track). */
export function withCrossfades(doc: ProjectDoc): Map<string, Clip> {
  const out = new Map<string, Clip>();
  const byTrack = new Map<string, Clip[]>();
  for (const c of doc.clips) (byTrack.get(c.trackId) ?? byTrack.set(c.trackId, []).get(c.trackId)!).push(c);
  for (const cs of byTrack.values()) {
    cs.sort((a, b) => a.start - b.start);
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!;
      const prev = cs[i - 1];
      const next = cs[i + 1];
      const xIn = prev ? Math.max(0, clipEnd(prev) - c.start) : 0;
      const xOut = next ? Math.max(0, clipEnd(c) - next.start) : 0;
      if (!xIn && !xOut) {
        out.set(c.id, c);
        continue;
      }
      const fadeIn = Math.min(c.length, Math.max(c.fadeIn, xIn));
      const fadeOut = Math.min(c.length - fadeIn, Math.max(c.fadeOut, xOut));
      out.set(c.id, { ...c, fadeIn, fadeOut });
    }
  }
  return out;
}

/** The crossfade regions on a track: [start, end) where two clips overlap. */
export function crossfades(doc: ProjectDoc, trackId: string): { from: number; to: number; outId: string; inId: string }[] {
  const cs = clipsOnTrack(doc, trackId);
  const out: { from: number; to: number; outId: string; inId: string }[] = [];
  for (let i = 1; i < cs.length; i++) {
    const a = cs[i - 1]!;
    const b = cs[i]!;
    if (b.start < clipEnd(a)) out.push({ from: b.start, to: clipEnd(a), outId: a.id, inId: b.id });
  }
  return out;
}

/** Move a clip (optionally to another track). Clips on one track never overlap. */
export function moveClip(doc: ProjectDoc, clipId: string, start: number, trackId?: string): EditResult {
  const c = clip(doc, clipId);
  if (!c) return fail("No such clip.");
  if (!isInt(start) || start < 0) return fail("A clip can't start before zero.");
  const to = trackId ?? c.trackId;
  for (const id of new Set([c.trackId, to])) {
    const e = editable(doc, id);
    if (e) return e;
  }
  const moved: Clip = { ...c, start, trackId: to };
  const bad = layoutProblem([...doc.clips.filter((x) => x.trackId === to && x.id !== c.id), moved]);
  if (bad) return fail(bad);
  return ok(replaceClips(doc, doc.clips.map((x) => (x.id === c.id ? moved : x))));
}

/** Trim one edge of a clip to a timeline position; source audio is never touched. */
export function trimClip(doc: ProjectDoc, clipId: string, edge: "start" | "end", to: number): EditResult {
  const c = clip(doc, clipId);
  if (!c) return fail("No such clip.");
  const locked = editable(doc, c.trackId);
  if (locked) return locked;
  if (!isInt(to)) return fail("Bad trim position.");
  const source = doc.sources.find((s) => s.id === c.sourceId);
  if (!source) return fail("The clip's source is missing.");
  let next: Clip;
  if (edge === "start") {
    const delta = to - c.start;
    const srcStart = c.srcStart + delta;
    if (srcStart < 0) return fail("There's no more audio before this point.");
    if (delta >= c.length) return fail("A clip can't be trimmed to nothing.");
    next = { ...c, start: to, srcStart, length: c.length - delta };
  } else {
    const length = to - c.start;
    if (length <= 0) return fail("A clip can't be trimmed to nothing.");
    if (c.srcStart + length > source.totalSamples) return fail("There's no more audio after this point.");
    next = { ...c, length };
  }
  if (next.start < 0) return fail("A clip can't start before zero.");
  const bad = layoutProblem([...doc.clips.filter((x) => x.trackId === c.trackId && x.id !== c.id), next]);
  if (bad) return fail(bad);
  next.fadeIn = Math.min(next.fadeIn, next.length);
  next.fadeOut = Math.min(next.fadeOut, next.length - next.fadeIn);
  return ok(replaceClips(doc, doc.clips.map((x) => (x.id === c.id ? next : x))));
}

export function deleteClip(doc: ProjectDoc, clipId: string, ripple = false): EditResult {
  const c = clip(doc, clipId);
  if (!c) return fail("No such clip.");
  return ripple ? cutRange(doc, c.start, clipEnd(c), { ripple: true, trackIds: [c.trackId] }) : (() => {
    const locked = editable(doc, c.trackId);
    return locked ?? ok(replaceClips(doc, doc.clips.filter((x) => x.id !== c.id)));
  })();
}

export function setClipLevels(doc: ProjectDoc, clipId: string, patch: { gainDb?: number; fadeIn?: number; fadeOut?: number }): EditResult {
  const c = clip(doc, clipId);
  if (!c) return fail("No such clip.");
  const locked = editable(doc, c.trackId);
  if (locked) return locked;
  const next = { ...c };
  if (patch.gainDb !== undefined) {
    if (!Number.isFinite(patch.gainDb) || patch.gainDb < GAIN_DB.min || patch.gainDb > GAIN_DB.max) return fail("Gain is out of range.");
    next.gainDb = patch.gainDb;
  }
  if (patch.fadeIn !== undefined) {
    if (!isInt(patch.fadeIn) || patch.fadeIn < 0) return fail("Bad fade.");
    next.fadeIn = patch.fadeIn;
  }
  if (patch.fadeOut !== undefined) {
    if (!isInt(patch.fadeOut) || patch.fadeOut < 0) return fail("Bad fade.");
    next.fadeOut = patch.fadeOut;
  }
  if (next.fadeIn + next.fadeOut > next.length) return fail("The fades are longer than the clip.");
  return ok(replaceClips(doc, doc.clips.map((x) => (x.id === c.id ? next : x))));
}

// ---- adding audio -----------------------------------------------------------------------

/**
 * Put a whole source on a track at `at` (a new track of `newTrack` kind if no `trackId`).
 * Strict about overlap on an existing track: the caller picks a free spot.
 */
export function addSourceClip(
  doc: ProjectDoc,
  input: { source: Source; trackId?: string; newTrack?: { kind: TrackKind; name?: string }; at: number },
): EditResult {
  const { source, at } = input;
  if (!isInt(at) || at < 0) return fail("Bad position.");
  if (!isInt(source.totalSamples) || source.totalSamples <= 0) return fail("That audio is empty.");
  // The same audio can be placed more than once (a jingle used twice): reuse its source.
  const existing = doc.sources.find((s) => s.assetId === source.assetId);
  const useSource = existing ?? source;
  if (!existing && doc.sources.some((s) => s.id === source.id)) return fail("That audio is already in the project.");
  let next = doc;
  let trackId = input.trackId;
  if (!trackId) {
    if (!input.newTrack) return fail("Choose a track.");
    if (doc.tracks.length >= 16) return fail("A project can have up to 16 tracks.");
    next = addTrack(doc, input.newTrack.kind, input.newTrack.name);
    trackId = next.tracks[next.tracks.length - 1]!.id;
  } else {
    const e = editable(doc, trackId);
    if (e) return e;
  }
  const clip: Clip = { id: newId(), trackId, sourceId: useSource.id, srcStart: 0, length: useSource.totalSamples, start: at, gainDb: 0, fadeIn: 0, fadeOut: 0 };
  if (overlaps(next.clips.filter((c) => c.trackId === trackId), clip)) return fail("That would overlap another clip on the track.");
  return ok({ ...next, sources: existing ? next.sources : [...next.sources, source], clips: [...next.clips, clip] });
}

/** The first free timeline position at or after `want` on a track where `length` samples fit. */
export function freeSpot(doc: ProjectDoc, trackId: string, want: number, length: number): number {
  let at = Math.max(0, want);
  for (const c of clipsOnTrack(doc, trackId)) {
    if (c.start >= at + length) break;
    if (clipEnd(c) > at) at = clipEnd(c);
  }
  return at;
}

// ---- range cuts (retake cleanup, "delete selection") -----------------------------------

/**
 * Remove the timeline range [from, to) from the chosen tracks (default: all).
 * - non-ripple: leaves a gap.
 * - ripple: later clips on every affected track shift left by `to - from`, so tracks that were
 *   in sync stay in sync. Ripple refuses when a track holding audio is locked or left out of
 *   the cut — that would silently put it out of sync with the others.
 */
/**
 * Remove [from, to) from the given tracks (all by default). `ripple` closes the gap; it must include
 * every track with audio so nothing drifts out of sync — unless `unsynced` is set, which ripples only
 * the given tracks on purpose (later audio on them moves earlier than on the others).
 */
export function cutRange(doc: ProjectDoc, from: number, to: number, opts: { ripple: boolean; trackIds?: string[]; unsynced?: boolean }): EditResult {
  if (!isInt(from) || !isInt(to) || from < 0 || to <= from) return fail("Bad range.");
  const targets = (opts.trackIds ?? doc.tracks.map((t) => t.id)).filter((id) => track(doc, id));
  const withAudio = doc.tracks.filter((t) => doc.clips.some((c) => c.trackId === t.id));
  for (const id of targets) {
    const t = track(doc, id)!;
    if (t.locked && doc.clips.some((c) => c.trackId === id && c.start < to && clipEnd(c) > from)) return fail(`Track "${t.name}" is locked.`);
  }
  if (opts.ripple && !opts.unsynced) {
    for (const t of withAudio) {
      if (!targets.includes(t.id)) return fail(`Ripple needs every track with audio; "${t.name}" is left out. Turn ripple off or include it.`);
      if (t.locked) return fail(`Track "${t.name}" is locked, so a ripple cut would put it out of sync. Unlock it or turn ripple off.`);
    }
  }
  const width = to - from;
  const out: Clip[] = [];
  for (const c of doc.clips) {
    if (!targets.includes(c.trackId)) {
      out.push(c);
      continue;
    }
    const end = clipEnd(c);
    if (end <= from) {
      out.push(c);
    } else if (c.start >= to) {
      out.push(opts.ripple ? { ...c, start: c.start - width } : c);
    } else {
      // Overlaps the range: keep the part before and the part after.
      if (c.start < from) {
        const len = from - c.start;
        out.push({ ...c, length: len, fadeOut: 0, fadeIn: Math.min(c.fadeIn, len) });
      }
      if (end > to) {
        const skip = to - c.start;
        out.push({ ...c, id: c.start < from ? newId() : c.id, srcStart: c.srcStart + skip, length: end - to, start: opts.ripple ? from : to, fadeIn: 0, fadeOut: Math.min(c.fadeOut, end - to) });
      }
    }
  }
  return ok(replaceClips(doc, out));
}

/** Several cuts as one edit (retake cleanup). Applied last-to-first so earlier ranges stay valid. */
export function cutRanges(doc: ProjectDoc, ranges: { from: number; to: number }[], opts: { ripple: boolean; trackIds?: string[] }): EditResult {
  const sorted = [...ranges].sort((a, b) => b.from - a.from);
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.to > sorted[i - 1]!.from) return fail("Cuts overlap.");
  let cur = doc;
  for (const r of sorted) {
    const res = cutRange(cur, r.from, r.to, opts);
    if (!res.ok) return res;
    cur = res.doc;
  }
  return ok(cur);
}

// ---- tracks & annotations --------------------------------------------------------------

export function addTrack(doc: ProjectDoc, kind: TrackKind, name?: string): ProjectDoc {
  const n = doc.tracks.filter((t) => t.kind === kind).length + 1;
  const label = kind[0]!.toUpperCase() + kind.slice(1);
  return { ...doc, tracks: [...doc.tracks, { id: newId(), name: name?.trim() || (n > 1 ? `${label} ${n}` : label), kind, muted: false, solo: false, locked: false, height: TRACK_HEIGHT.default }] };
}

export function updateTrack(doc: ProjectDoc, trackId: string, patch: Partial<Pick<Track, "name" | "muted" | "solo" | "locked" | "height" | "gainDb" | "pan">> & { color?: string | null; fx?: TrackFx | null }): EditResult {
  const t = track(doc, trackId);
  if (!t) return fail("No such track.");
  const next = { ...t };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name || name.length > 60) return fail("A track name is 1–60 characters.");
    next.name = name;
  }
  if (patch.muted !== undefined) next.muted = patch.muted;
  if (patch.solo !== undefined) next.solo = patch.solo;
  if (patch.locked !== undefined) next.locked = patch.locked;
  if (patch.height !== undefined) next.height = Math.round(Math.min(TRACK_HEIGHT.max, Math.max(TRACK_HEIGHT.min, patch.height)));
  if (patch.gainDb !== undefined) {
    if (typeof patch.gainDb !== "number" || !Number.isFinite(patch.gainDb)) return fail("Bad track volume.");
    const g = Math.round(Math.min(TRACK_GAIN_DB.max, Math.max(TRACK_GAIN_DB.min, patch.gainDb)) * 10) / 10;
    if (g === 0) delete next.gainDb;
    else next.gainDb = g;
  }
  if (patch.pan !== undefined) {
    if (typeof patch.pan !== "number" || !Number.isFinite(patch.pan)) return fail("Bad pan.");
    const pn = Math.round(Math.max(-1, Math.min(1, patch.pan)) * 100) / 100;
    if (pn === 0) delete next.pan;
    else next.pan = pn;
  }
  if (patch.fx === null) delete next.fx;
  else if (patch.fx !== undefined) {
    const f = normalizeFx(patch.fx);
    if (!f) return fail("Bad FX settings.");
    next.fx = f;
  }
  if (patch.color === null) delete next.color;
  else if (patch.color !== undefined) {
    if (!isHex(patch.color)) return fail("A track color is #rrggbb.");
    next.color = patch.color.toLowerCase();
  }
  return ok({ ...doc, tracks: doc.tracks.map((x) => (x.id === t.id ? next : x)) });
}

export function removeTrack(doc: ProjectDoc, trackId: string): EditResult {
  const t = track(doc, trackId);
  if (!t) return fail("No such track.");
  if (t.locked) return fail(`Track "${t.name}" is locked.`);
  if (doc.tracks.length === 1) return fail("A project needs at least one track.");
  return ok(withRules({ ...doc, tracks: doc.tracks.filter((x) => x.id !== t.id), clips: doc.clips.filter((c) => c.trackId !== t.id) }, (r) => cleanRule(r, new Set(doc.tracks.filter((x) => x.id !== t.id).map((x) => x.id)))));
}

/** Drop a source and everything that uses it (its clips and marks), e.g. when its audio no longer exists. */
export function removeSource(doc: ProjectDoc, sourceId: string): ProjectDoc {
  return { ...doc, sources: doc.sources.filter((s) => s.id !== sourceId), clips: doc.clips.filter((c) => c.sourceId !== sourceId), annotations: doc.annotations.filter((a) => a.sourceId !== sourceId) };
}

export function addChapter(doc: ProjectDoc, sourceId: string, sample: number, label: string): EditResult {
  const s = doc.sources.find((x) => x.id === sourceId);
  if (!s || !isInt(sample) || sample < 0 || sample >= s.totalSamples) return fail("Bad chapter position.");
  const text = label.trim();
  if (!text || text.length > 120) return fail("A chapter title is 1–120 characters.");
  return ok({ ...doc, annotations: [...doc.annotations, { id: newId(), kind: "chapter", sourceId, sample, label: text }] });
}

export function removeAnnotation(doc: ProjectDoc, id: string): ProjectDoc {
  return { ...doc, annotations: doc.annotations.filter((a) => a.id !== id) };
}

// ---- ducking ----------------------------------------------------------------------------

/** The tracks that trigger a rule (speech = every host and guest track). */
export function triggerTrackIds(doc: ProjectDoc, rule: DuckRule): string[] {
  const ids = rule.triggers === "speech" ? doc.tracks.filter((t) => t.kind === "host" || t.kind === "guest").map((t) => t.id) : rule.triggers.filter((id) => doc.tracks.some((t) => t.id === id));
  return ids.filter((id) => !rule.targets.includes(id));
}

/** Drop unknown tracks; a track can't both trigger and be ducked by the same rule. Null if nothing is left to duck. */
function cleanRule(r: DuckRule, trackIds: Set<string>): DuckRule | null {
  const targets = r.targets.filter((id) => trackIds.has(id));
  const triggers = r.triggers === "speech" ? "speech" : r.triggers.filter((id) => trackIds.has(id) && !targets.includes(id));
  return targets.length ? { ...r, targets, triggers } : null;
}

function withRules(doc: ProjectDoc, f: (r: DuckRule) => DuckRule | null): ProjectDoc {
  if (!doc.ducking) return doc;
  return { ...doc, ducking: doc.ducking.map(f).filter((r): r is DuckRule => r !== null) };
}

const clampTo = (n: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, n));

/** A new rule: music and SFX tracks duck whenever a host or guest speaks. */
export function addDuckRule(doc: ProjectDoc): EditResult {
  const rules = doc.ducking ?? [];
  if (rules.length >= DUCK.maxRules) return fail(`A project can have up to ${DUCK.maxRules} ducking rules.`);
  const targets = doc.tracks.filter((t) => t.kind === "music" || t.kind === "sfx").map((t) => t.id);
  if (targets.length === 0) return fail("Add a music or SFX track first — ducking turns those down under the voices.");
  const rule: DuckRule = { id: newId(), enabled: true, targets, triggers: "speech", amountDb: DUCK.amountDb.default, thresholdDb: DUCK.thresholdDb.default, attackMs: DUCK.attackMs.default, releaseMs: DUCK.releaseMs.default };
  return ok({ ...doc, ducking: [...rules, rule] });
}

export function updateDuckRule(doc: ProjectDoc, id: string, patch: Partial<Omit<DuckRule, "id">>): EditResult {
  const cur = doc.ducking?.find((r) => r.id === id);
  if (!cur) return fail("No such ducking rule.");
  const ids = new Set(doc.tracks.map((t) => t.id));
  const next: DuckRule = { ...cur };
  if (patch.enabled !== undefined) next.enabled = !!patch.enabled;
  if (patch.amountDb !== undefined) {
    if (!Number.isFinite(patch.amountDb)) return fail("Bad amount.");
    next.amountDb = clampTo(patch.amountDb, DUCK.amountDb);
  }
  if (patch.thresholdDb !== undefined) {
    if (!Number.isFinite(patch.thresholdDb)) return fail("Bad threshold.");
    next.thresholdDb = clampTo(patch.thresholdDb, DUCK.thresholdDb);
  }
  if (patch.attackMs !== undefined) {
    if (!Number.isFinite(patch.attackMs)) return fail("Bad attack.");
    next.attackMs = clampTo(patch.attackMs, DUCK.attackMs);
  }
  if (patch.releaseMs !== undefined) {
    if (!Number.isFinite(patch.releaseMs)) return fail("Bad release.");
    next.releaseMs = clampTo(patch.releaseMs, DUCK.releaseMs);
  }
  if (patch.targets !== undefined) next.targets = patch.targets.filter((t) => ids.has(t));
  if (patch.triggers !== undefined) next.triggers = patch.triggers === "speech" ? "speech" : patch.triggers.filter((t) => ids.has(t));
  if (next.targets.length === 0) return fail("Pick at least one track to duck.");
  // a track can't both trigger and be ducked: the track just chosen wins
  if (next.triggers !== "speech") {
    const keepTargets = patch.targets !== undefined;
    next.triggers = next.triggers.filter((t) => !next.targets.includes(t));
    if (!keepTargets && patch.triggers !== undefined) next.targets = next.targets.filter((t) => !(next.triggers as string[]).includes(t));
    if (next.targets.length === 0) return fail("Pick at least one track to duck.");
  }
  return ok({ ...doc, ducking: doc.ducking!.map((r) => (r.id === id ? next : r)) });
}

export function removeDuckRule(doc: ProjectDoc, id: string): ProjectDoc {
  return { ...doc, ducking: (doc.ducking ?? []).filter((r) => r.id !== id) };
}

// ---- original-to-edited time map -------------------------------------------------------

export interface Segment {
  clipId: string;
  sourceId: string;
  srcStart: number;
  srcEnd: number;
  start: number;
  end: number;
}

/** Every stretch of source audio that still plays, and where. Sorted by timeline position. */
export function timeMap(doc: ProjectDoc, trackId?: string): Segment[] {
  return doc.clips
    .filter((c) => !trackId || c.trackId === trackId)
    .map((c) => ({ clipId: c.id, sourceId: c.sourceId, srcStart: c.srcStart, srcEnd: c.srcStart + c.length, start: c.start, end: clipEnd(c) }))
    .sort((a, b) => a.start - b.start);
}

/** Where a source sample lands on the timeline (first clip that plays it), or null if it was cut. */
export function sourceToEdited(doc: ProjectDoc, sourceId: string, sample: number, trackId?: string): number | null {
  for (const s of timeMap(doc, trackId)) if (s.sourceId === sourceId && sample >= s.srcStart && sample < s.srcEnd) return s.start + (sample - s.srcStart);
  return null;
}

/** Which source sample plays at a timeline position on a track, or null in a gap. */
export function editedToSource(doc: ProjectDoc, trackId: string, at: number): { sourceId: string; sample: number } | null {
  for (const s of timeMap(doc, trackId)) if (at >= s.start && at < s.end) return { sourceId: s.sourceId, sample: s.srcStart + (at - s.start) };
  return null;
}

/** Annotations that still sit on playing audio, with their timeline position. */
export function annotationPositions(doc: ProjectDoc): (Annotation & { at: number })[] {
  const out: (Annotation & { at: number })[] = [];
  for (const a of doc.annotations) {
    const at = sourceToEdited(doc, a.sourceId, a.sample);
    if (at !== null) out.push({ ...a, at });
  }
  return out.sort((x, y) => x.at - y.at);
}

// ---- validation (server side; the browser's JSON is never trusted) ---------------------

const MAX_TRACKS = 16;
const MAX_CLIPS = 5000;
const MAX_ANNOTATIONS = 2000;
const isStr = (v: unknown, max = 200): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/** Parse and check an untrusted document. Returns a clean copy (unknown fields dropped) or the first problem. */
export function parseProject(raw: unknown): { ok: true; doc: ProjectDoc } | EditError {
  if (!raw || typeof raw !== "object") return fail("The project isn't an object.");
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== PROJECT_SCHEMA_VERSION) return fail("Unsupported project version.");
  if (!isInt(r.sampleRate) || r.sampleRate < 8000 || r.sampleRate > 192000) return fail("Bad sample rate.");
  if (!Array.isArray(r.sources) || !Array.isArray(r.tracks) || !Array.isArray(r.clips) || !Array.isArray(r.annotations)) return fail("The project is missing a list.");
  if (r.tracks.length < 1 || r.tracks.length > MAX_TRACKS) return fail("Track count out of range.");
  if (r.clips.length > MAX_CLIPS || r.annotations.length > MAX_ANNOTATIONS) return fail("The project is too large.");

  const sources: Source[] = [];
  for (const s of r.sources as Record<string, unknown>[]) {
    if (!s || !isStr(s.id) || !isStr(s.assetId) || !isStr(s.label, 200) || !isInt(s.totalSamples) || s.totalSamples <= 0) return fail("Bad source.");
    if (s.recordingId !== undefined && !isStr(s.recordingId)) return fail("Bad source.");
    if (s.channels !== undefined && s.channels !== 1 && s.channels !== 2) return fail("Bad source.");
    sources.push({ id: s.id, assetId: s.assetId, ...(s.recordingId ? { recordingId: s.recordingId as string } : {}), label: s.label, totalSamples: s.totalSamples, ...(s.channels === 2 ? { channels: 2 as const } : {}) });
  }
  const tracks: Track[] = [];
  for (const t of r.tracks as Record<string, unknown>[]) {
    if (!t || !isStr(t.id) || !isStr(t.name, 60) || !TRACK_KINDS.includes(t.kind as TrackKind)) return fail("Bad track.");
    if (typeof t.muted !== "boolean" || typeof t.solo !== "boolean" || typeof t.locked !== "boolean") return fail("Bad track.");
    if (typeof t.height !== "number" || !Number.isFinite(t.height)) return fail("Bad track.");
    if (t.color !== undefined && !isHex(t.color)) return fail("Bad track color.");
    const fx = t.fx === undefined ? undefined : normalizeFx(t.fx);
    if (fx === null) return fail("Bad FX settings.");
    if (t.pan !== undefined && (typeof t.pan !== "number" || !Number.isFinite(t.pan) || t.pan < -1 || t.pan > 1)) return fail("Bad pan.");
    if (t.gainDb !== undefined && (typeof t.gainDb !== "number" || !Number.isFinite(t.gainDb) || t.gainDb < TRACK_GAIN_DB.min || t.gainDb > TRACK_GAIN_DB.max)) return fail("Bad track volume.");
    tracks.push({ id: t.id, name: t.name, kind: t.kind as TrackKind, muted: t.muted, solo: t.solo, locked: t.locked, height: Math.round(Math.min(TRACK_HEIGHT.max, Math.max(TRACK_HEIGHT.min, t.height))), ...(t.color ? { color: (t.color as string).toLowerCase() } : {}), ...(typeof t.gainDb === "number" && t.gainDb !== 0 ? { gainDb: t.gainDb } : {}), ...(typeof t.pan === "number" && t.pan !== 0 ? { pan: t.pan } : {}), ...(fx ? { fx } : {}) });
  }
  const clips: Clip[] = [];
  for (const c of r.clips as Record<string, unknown>[]) {
    if (!c || !isStr(c.id) || !isStr(c.trackId) || !isStr(c.sourceId)) return fail("Bad clip.");
    if (!isInt(c.srcStart) || !isInt(c.length) || !isInt(c.start) || !isInt(c.fadeIn) || !isInt(c.fadeOut)) return fail("Bad clip.");
    if (typeof c.gainDb !== "number" || !Number.isFinite(c.gainDb) || c.gainDb < GAIN_DB.min || c.gainDb > GAIN_DB.max) return fail("Bad clip gain.");
    if (c.srcStart < 0 || c.length <= 0 || c.start < 0 || c.fadeIn < 0 || c.fadeOut < 0 || c.fadeIn + c.fadeOut > c.length) return fail("Bad clip.");
    const src = sources.find((s) => s.id === c.sourceId);
    if (!src || c.srcStart + c.length > src.totalSamples) return fail("A clip reaches outside its source.");
    if (!tracks.some((t) => t.id === c.trackId)) return fail("A clip is on a missing track.");
    clips.push({ id: c.id, trackId: c.trackId, sourceId: c.sourceId, srcStart: c.srcStart, length: c.length, start: c.start, gainDb: c.gainDb, fadeIn: c.fadeIn, fadeOut: c.fadeOut });
  }
  const annotations: Annotation[] = [];
  for (const a of r.annotations as Record<string, unknown>[]) {
    if (!a || !isStr(a.id) || (a.kind !== "retake" && a.kind !== "chapter") || !isStr(a.sourceId) || !isInt(a.sample) || a.sample < 0 || typeof a.label !== "string" || a.label.length > 120) return fail("Bad annotation.");
    const src = sources.find((s) => s.id === a.sourceId);
    if (!src || a.sample >= src.totalSamples) return fail("Bad annotation.");
    annotations.push({ id: a.id, kind: a.kind, sourceId: a.sourceId, sample: a.sample, label: a.label });
  }
  let ducking: DuckRule[] | undefined;
  if (r.ducking !== undefined) {
    if (!Array.isArray(r.ducking) || r.ducking.length > DUCK.maxRules) return fail("Bad ducking rules.");
    ducking = [];
    const trackIds = new Set(tracks.map((t) => t.id));
    for (const d of r.ducking as Record<string, unknown>[]) {
      if (!d || !isStr(d.id) || typeof d.enabled !== "boolean") return fail("Bad ducking rule.");
      const inRange = (v: unknown, range: { min: number; max: number }): v is number => typeof v === "number" && Number.isFinite(v) && v >= range.min && v <= range.max;
      if (!inRange(d.amountDb, DUCK.amountDb) || !inRange(d.thresholdDb, DUCK.thresholdDb) || !inRange(d.attackMs, DUCK.attackMs) || !inRange(d.releaseMs, DUCK.releaseMs)) return fail("Bad ducking rule.");
      if (!Array.isArray(d.targets) || d.targets.length === 0 || !d.targets.every((t) => typeof t === "string" && trackIds.has(t))) return fail("A ducking rule points at a missing track.");
      const triggers = d.triggers === "speech" ? "speech" : Array.isArray(d.triggers) && d.triggers.every((t) => typeof t === "string" && trackIds.has(t)) ? (d.triggers as string[]) : null;
      if (triggers === null) return fail("A ducking rule points at a missing track.");
      ducking.push({ id: d.id, enabled: d.enabled, targets: d.targets as string[], triggers, amountDb: d.amountDb, thresholdDb: d.thresholdDb, attackMs: d.attackMs, releaseMs: d.releaseMs });
    }
    if (new Set(ducking.map((x) => x.id)).size !== ducking.length) return fail("Duplicate ids.");
  }
  for (const list of [sources, tracks, clips, annotations]) if (new Set(list.map((x) => x.id)).size !== list.length) return fail("Duplicate ids.");
  for (const t of tracks) {
    const cs = clips.filter((c) => c.trackId === t.id).sort((a, b) => a.start - b.start);
    const bad = layoutProblem(cs);
    if (bad) return fail(`"${t.name}": ${bad}`);
  }
  let delivery: ProjectDoc["delivery"];
  if (r.delivery !== undefined) {
    const d = r.delivery as Record<string, unknown> | null;
    if (!d || !isDeliveryPreset(d.preset)) return fail("Bad delivery preset.");
    delivery = { preset: d.preset };
  }
  return { ok: true, doc: { schemaVersion: PROJECT_SCHEMA_VERSION, sampleRate: r.sampleRate, sources, tracks, clips, annotations, ...(ducking ? { ducking } : {}), ...(delivery ? { delivery } : {}) } };
}
