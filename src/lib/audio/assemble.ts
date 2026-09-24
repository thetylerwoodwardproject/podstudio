/*
 * Continuous sessions (8a/8b): one long recording per track, with retakes
 * and pauses as markers instead of separate takes.
 *
 * The assembled edit keeps the last attempt of each line: a retake on line L
 * at time t cuts from the most recent time line L started (before t) up to
 * t. Pauses are cut, kept, or used to split the edit into separate files.
 * All times are in seconds from the start of the session.
 */

export interface SessionMarker {
  t: number;
  kind: 'retake' | 'pause';
  /** Zero-based script line */
  line: number;
  /** Retakes: which attempt this starts (2 = first retake) */
  attempt?: number;
  /** Pauses: when recording resumed */
  end?: number;
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

export function assemble(duration: number, markers: SessionMarker[], lineLog: LineStart[], pauses: PauseMode): Assembly {
  const pauseRanges: Range[] = markers
    .filter((m) => m.kind === 'pause')
    .map((m) => [m.t, Math.min(duration, m.end ?? duration)] as Range);
  const cuts = merge([
    ...retakeCuts(markers, lineLog).map(([a, b]) => [Math.max(0, a), Math.min(duration, b)] as Range),
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
