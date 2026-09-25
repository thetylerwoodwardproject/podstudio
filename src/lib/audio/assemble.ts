/*
 * Continuous sessions (8a/8b): one long recording per track, with retakes
 * and pauses as markers instead of separate takes.
 *
 * The assembled edit keeps the last attempt of each line: a retake on line L
 * at time t cuts from the most recent time line L started (before t) up to
 * t. Pauses are cut, kept, or used to split the edit into separate files.
 * A cough doesn't cut: it mutes that stretch of the cougher's own track in the
 * edit (see mutes()), so every track keeps the same length and stays in sync.
 * Ad-libs and pad presses (hotkey pads) are only marked: they stay in the edit.
 *
 * Markers are stored on the wall clock, in seconds from the start of the
 * session. When the mic stops (the phone locked, the tab was left), no audio
 * is written for that stretch and a `gap` marker records it, so everything
 * after a gap sits earlier in the audio than on the clock: onAudio() converts.
 */

export interface SessionMarker {
  t: number;
  kind: 'retake' | 'pause' | 'adlib' | 'cut' | 'gap' | 'pad';
  /** Zero-based script line */
  line: number;
  /** Retakes: which attempt this starts (2 = first retake) */
  attempt?: number;
  /** Pauses: when recording resumed. Ad-libs: when the script resumed. Cuts and gaps: when they ended */
  end?: number;
  /** Gaps, after onAudio(): seconds the mic was stopped (the audio has none of them) */
  lost?: number;
  /** Coughs: whose track it mutes (none = the host's) */
  who?: 'host' | 'guest';
  /** Pad presses: which pad (key 1–9), its name and Syntax colour. `end` is when the sound stopped */
  pad?: { key: number; id: string; name: string; color: string };
}

/** A cough's mute reaches this far past the button on each side. */
export const CUT_PADDING = 0.15;

/** Wall-clock stretches the mic was stopped, in order. */
function gapRanges(markers: SessionMarker[]): Range[] {
  return merge(markers.filter((m) => m.kind === 'gap' && m.end != null).map((m) => [m.t, m.end!] as Range));
}

/** Where wall-clock time `t` is in the audio: earlier gaps taken off (a time inside a gap lands where it started). */
export function audioTime(t: number, gaps: Range[]): number {
  let shift = 0;
  for (const [a, b] of gaps) {
    if (t <= a) break;
    shift += Math.min(t, b) - a;
  }
  return t - shift;
}

/**
 * Markers and line starts moved from the wall clock onto the audio. Gaps
 * become points where the audio jumps, carrying how long the mic was stopped.
 */
export function onAudio(markers: SessionMarker[], lineLog: LineStart[]): { markers: SessionMarker[]; lineLog: LineStart[] } {
  const gaps = gapRanges(markers);
  if (!gaps.length) return { markers, lineLog };
  const at = (t: number) => audioTime(t, gaps);
  return {
    markers: markers.map((m) =>
      m.kind === 'gap'
        ? { ...m, t: at(m.t), end: undefined, lost: (m.end ?? m.t) - m.t }
        : { ...m, t: at(m.t), ...(m.end != null ? { end: at(m.end) } : {}) },
    ),
    lineLog: lineLog.map((s) => ({ ...s, t: at(s.t) })),
  };
}

export interface LineStart {
  t: number;
  line: number;
}

export type PauseMode = 'cut' | 'keep' | 'split';

export type Range = [number, number];

export interface Assembly {
  /** Each file is a list of ranges to join, in order */
  files: Range[][];
  /** Stretches removed from the recording */
  cuts: Range[];
  /** Seconds removed */
  removed: number;
}

/** Merge overlapping or touching ranges. */
export function merge(ranges: Range[]): Range[] {
  const sorted = ranges.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Stretches the retakes replace. */
export function retakeCuts(markers: SessionMarker[], lineLog: LineStart[]): Range[] {
  const cuts: Range[] = [];
  for (const m of markers) {
    if (m.kind !== 'retake') continue;
    const started = lineLog.filter((s) => s.line === m.line && s.t < m.t).at(-1);
    if (started) cuts.push([started.t, m.t]);
  }
  return cuts;
}

/**
 * The edit of a recording `duration` seconds long. Takes wall-clock markers
 * (as recorded) and converts them with onAudio() first. The same cuts apply
 * to every track (mic, guest, pads); coughs are muted instead, per track.
 */
export function assemble(duration: number, wallMarkers: SessionMarker[], wallLineLog: LineStart[], pauses: PauseMode): Assembly {
  const { markers, lineLog } = onAudio(wallMarkers, wallLineLog);
  const clamp = ([a, b]: Range) => [Math.max(0, a), Math.min(duration, b)] as Range;
  const pauseRanges: Range[] = markers
    .filter((m) => m.kind === 'pause')
    .map((m) => [m.t, Math.min(duration, m.end ?? duration)] as Range);
  const cuts = merge([
    ...retakeCuts(markers, lineLog).map(clamp),
    ...(pauses === 'keep' ? [] : pauseRanges),
  ]);

  // Everything not cut.
  const kept: Range[] = [];
  let at = 0;
  for (const [a, b] of cuts) {
    if (a > at) kept.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < duration) kept.push([at, duration]);

  let files: Range[][] = [kept];
  if (pauses === 'split' && pauseRanges.length) {
    // Start a new file after each pause.
    const bounds = pauseRanges.map(([, end]) => end).sort((x, y) => x - y);
    files = [];
    let current: Range[] = [];
    let next = 0;
    for (const r of kept) {
      while (next < bounds.length && r[0] >= bounds[next]) {
        if (current.length) files.push(current);
        current = [];
        next++;
      }
      current.push(r);
    }
    if (current.length) files.push(current);
  }

  const removed = cuts.reduce((n, [a, b]) => n + (b - a), 0);
  return { files: files.filter((f) => f.length), cuts, removed };
}

/**
 * Stretches of one person's track to silence in the edit: their coughs, on the
 * audio clock (wall-clock markers are converted), merged. Times are in the
 * recording, before any cuts.
 */
export function mutes(wallMarkers: SessionMarker[], who: 'host' | 'guest', duration = Infinity): Range[] {
  const { markers } = onAudio(wallMarkers, []);
  return merge(
    markers
      .filter((m) => m.kind === 'cut' && (m.who ?? 'host') === who)
      .map((m) => [Math.max(0, m.t), Math.min(duration, m.end ?? m.t)] as Range),
  );
}

/**
 * Where the mutes land in an edit made of `ranges` (joined in order): output
 * seconds, for silencing the joined file.
 */
export function mutesInEdit(ranges: Range[], muted: Range[]): Range[] {
  const out: Range[] = [];
  let offset = 0;
  for (const [a, b] of ranges) {
    for (const [ma, mb] of muted) {
      const s = Math.max(a, ma);
      const e = Math.min(b, mb);
      if (e > s) out.push([offset + s - a, offset + e - a]);
    }
    offset += b - a;
  }
  return merge(out);
}

/** Audacity label track: start, end, label per line (point labels have start = end). */
export function audacityLabels(markers: SessionMarker[], label: (m: SessionMarker) => string): string {
  return (
    [...markers]
      .sort((a, b) => a.t - b.t)
      .map((m) => `${m.t.toFixed(6)}\t${(m.end ?? m.t).toFixed(6)}\t${label(m)}`)
      .join('\n') + '\n'
  );
}

/** Where time `t` of the recording lands in an edit made of `ranges`, or null if it was cut. */
export function mapTime(t: number, ranges: Range[]): number | null {
  let offset = 0;
  for (const [a, b] of ranges) {
    if (t >= a && t <= b) return offset + (t - a);
    offset += b - a;
  }
  return null;
}
