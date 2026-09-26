/*
 * Frequency graphs (framework: Graphs & calibration). The geometry only:
 * a log frequency axis from 20 Hz to 20 kHz, a dB axis of ±24 with a line
 * every 6, the grid lines, and curves as SVG paths. lib/graph-view.ts draws
 * them; this part is pure so it can be tested.
 */

export const F_MIN = 20;
export const F_MAX = 20000;
export const DB_RANGE = 24;
export const DB_STEP = 6;

export type Point = [freq: number, db: number];

/** 0 to 1 across the plot for a frequency (log). */
export const freqPos = (f: number) => Math.log10(Math.min(F_MAX, Math.max(F_MIN, f)) / F_MIN) / Math.log10(F_MAX / F_MIN);

/** 0 (top, +24) to 1 (bottom, −24) down the plot for a level. */
export const dbPos = (db: number) => (DB_RANGE - Math.min(DB_RANGE, Math.max(-DB_RANGE, db))) / (2 * DB_RANGE);

/**
 * Grid lines: majors on each decade's 1-2-5 steps (20, 50, 100, 200 …),
 * minors on the other whole steps (30, 40, 60 …).
 */
export function freqGrid(): { major: number[]; minor: number[] } {
  const major: number[] = [];
  const minor: number[] = [];
  for (let decade = 10; decade <= 10000; decade *= 10)
    for (let k = 1; k <= 9; k++) {
      const f = k * decade;
      if (f < F_MIN || f > F_MAX) continue;
      (k === 1 || k === 2 || k === 5 ? major : minor).push(f);
    }
  return { major, minor };
}

/** The labelled frequencies (as in the framework): 50 Hz to 10 kHz. */
export const FREQ_LABELS = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
export const freqLabel = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f));

/** Level lines every 6 dB; the labelled ones stop one step inside the edges. */
export function dbLines(): number[] {
  const out: number[] = [];
  for (let d = DB_RANGE; d >= -DB_RANGE; d -= DB_STEP) out.push(d);
  return out;
}
export const dbLabel = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '0');

/** An SVG path through the points, in a plot `w` × `h`, left to right. */
export function curvePath(points: Point[], w: number, h: number): string {
  const sorted = [...points].filter(([f, d]) => f > 0 && Number.isFinite(d)).sort((a, b) => a[0] - b[0]);
  return sorted.map(([f, d], i) => `${i ? 'L' : 'M'}${(freqPos(f) * w).toFixed(1)} ${(dbPos(d) * h).toFixed(1)}`).join(' ');
}

/**
 * A spectrum (FFT bins, dB) as points on the log axis: averaged into about
 * `columns` buckets so the high end isn't a solid block, and offset so its
 * loudest bucket sits `top` dB up the plot.
 */
export function spectrumPoints(bins: ArrayLike<number>, sampleRate: number, columns = 160, top = 18): Point[] {
  const binHz = sampleRate / 2 / bins.length;
  const sums = new Float64Array(columns);
  const counts = new Uint32Array(columns);
  for (let i = 1; i < bins.length; i++) {
    const f = i * binHz;
    if (f < F_MIN || f > F_MAX || !Number.isFinite(bins[i])) continue;
    const c = Math.min(columns - 1, Math.floor(freqPos(f) * columns));
    sums[c] += 10 ** (bins[i] / 10);
    counts[c]++;
  }
  const pts: Point[] = [];
  for (let c = 0; c < columns; c++)
    if (counts[c]) pts.push([F_MIN * (F_MAX / F_MIN) ** ((c + 0.5) / columns), 10 * Math.log10(sums[c] / counts[c])]);
  const peak = Math.max(...pts.map((p) => p[1]));
  return pts.map(([f, d]) => [f, d - peak + top]);
}
