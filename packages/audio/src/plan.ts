// What plays when: turns a project document into the pieces of source audio to schedule for a
// timeline window. Pure — the Web Audio player (preview) and, later, the worker's render both
// follow the same plan, which is what keeps preview and export aligned.
import { clipEnd, type Clip, type ProjectDoc } from "./document";

/** Source samples decoded per window; also the largest piece a node is asked to play. */
export const WINDOW_SAMPLES = 480_000; // 10 s at 48 kHz

export interface Piece {
  clipId: string;
  trackId: string;
  sourceId: string;
  /** Timeline position of the piece's first sample. */
  start: number;
  /** First source sample. */
  srcStart: number;
  length: number;
}

/** Tracks that make sound: nothing muted, and only the soloed ones if any are soloed. */
export function audibleTracks(doc: ProjectDoc): Set<string> {
  const anySolo = doc.tracks.some((t) => t.solo);
  return new Set(doc.tracks.filter((t) => (anySolo ? t.solo : !t.muted)).map((t) => t.id));
}

/** Pieces overlapping the timeline window [from, to), each within a single source window. */
export function planPieces(doc: ProjectDoc, from: number, to: number): Piece[] {
  const audible = audibleTracks(doc);
  const out: Piece[] = [];
  for (const c of doc.clips) {
    if (!audible.has(c.trackId)) continue;
    const a = Math.max(from, c.start);
    const b = Math.min(to, clipEnd(c));
    if (b <= a) continue;
    let t = a;
    while (t < b) {
      const src = c.srcStart + (t - c.start);
      const room = WINDOW_SAMPLES - (src % WINDOW_SAMPLES);
      const len = Math.min(b - t, room);
      out.push({ clipId: c.id, trackId: c.trackId, sourceId: c.sourceId, start: t, srcStart: src, length: len });
      t += len;
    }
  }
  return out.sort((x, y) => x.start - y.start);
}

export const dbToGain = (db: number) => Math.pow(10, db / 20);

/** Linear gain of a clip at a timeline sample: clip gain × linear fade in/out. */
export function clipGainAt(c: Clip, t: number): number {
  let g = dbToGain(c.gainDb);
  if (c.fadeIn > 0 && t < c.start + c.fadeIn) g *= Math.max(0, (t - c.start) / c.fadeIn);
  const outStart = clipEnd(c) - c.fadeOut;
  if (c.fadeOut > 0 && t > outStart) g *= Math.max(0, (clipEnd(c) - t) / c.fadeOut);
  return g;
}

/** Breakpoints (timeline sample, gain) across a piece, so linear ramps reproduce the fades exactly. */
export function gainBreakpoints(c: Clip, p: Piece): [number, number][] {
  const end = p.start + p.length;
  const pts = new Set<number>([p.start, end]);
  for (const t of [c.start + c.fadeIn, clipEnd(c) - c.fadeOut]) if (t > p.start && t < end) pts.add(t);
  return [...pts].sort((a, b) => a - b).map((t) => [t, clipGainAt(c, t)]);
}
