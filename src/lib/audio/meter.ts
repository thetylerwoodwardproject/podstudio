/*
 * Level meter: the scale, the standard dBFS traffic-light zones, and what to
 * tell the person at the mic. Shared by the host's and a guest's mic check.
 *
 * Zones: green below -18 dBFS (safe, low level), amber -18 to -6 (the target
 * zone, where dialogue should peak, ideally -12 to -10), red above -6 (danger).
 */

/** dBFS → position on the meter: -60, -24, -12, -6 and 0 dBFS evenly spaced. */
const SCALE: [number, number][] = [[-60, 0], [-24, 0.25], [-12, 0.5], [-6, 0.75], [0, 1]];

export function toFraction(db: number): number {
  if (!Number.isFinite(db) || db <= -60) return 0;
  for (let i = 1; i < SCALE.length; i++) {
    const [d1, f1] = SCALE[i];
    const [d0, f0] = SCALE[i - 1];
    if (db <= d1) return f0 + ((db - d0) / (d1 - d0)) * (f1 - f0);
  }
  return 1;
}

export const OK = 'var(--color-ok)';
export const WARN = 'var(--color-warn)';
export const BAD = 'var(--color-rec)';

/** The zone colour for a level. */
export const zone = (db: number) => (db > -6 ? BAD : db >= -18 ? WARN : OK);

/**
 * What to tell the person, the zone colour, and how a check rates it (green =
 * good). Judged on the whole-dB value shown, so a peak shown as -18 or -6 is in.
 */
export function verdict(exact: number): [text: string, color: string, grade: string] {
  const db = Math.round(exact);
  if (db > -6) return ['Too hot · turn the gain down', BAD, BAD];
  if (db >= -12 && db <= -10) return ['Right on target', WARN, OK];
  if (db >= -18) return ['In the target zone', WARN, OK];
  if (db >= -24) return ['A little low · turn the gain up a touch', OK, WARN];
  return ['Low · turn the gain up', OK, WARN];
}

/** How fast a peak meter falls, dB per second (about a broadcast PPM: 20 dB in 1.7 s). */
export const FALL_DB_PER_S = 12;
/** How long the peak-hold (and the number beside a meter) keeps the highest peak. */
export const HOLD_MS = 1500;

/**
 * Peak-meter ballistics: snaps up to each peak and falls by time, in dB, so it
 * moves the same however often levels arrive. The hold is the highest peak of
 * the last HOLD_MS, the number shown beside the meter.
 */
export class PeakMeter {
  private shownDb = -Infinity;
  private at = 0;
  private peaks: { db: number; at: number }[] = [];

  update(peakDb: number, now: number) {
    const fallen = Number.isFinite(this.shownDb) ? this.shownDb - (FALL_DB_PER_S * Math.max(0, now - this.at)) / 1000 : -Infinity;
    this.shownDb = Math.max(peakDb, fallen);
    this.at = now;
    this.peaks.push({ db: peakDb, at: now });
    while (this.peaks.length && now - this.peaks[0].at > HOLD_MS) this.peaks.shift();
    const holdDb = Math.max(...this.peaks.map((p) => p.db));
    return { db: this.shownDb, fraction: toFraction(this.shownDb), holdDb, holdFraction: toFraction(holdDb) };
  }
}

/**
 * Drive a row of meter segments from peak levels: coloured by zone, with a fast
 * attack and a timed release like a hardware meter, and the held peak's segment lit.
 */
export function segmentMeter(segs: HTMLElement[]) {
  // Each segment's zone is the level at its top edge.
  const zones = segs.map((_, i) => {
    const f = (i + 1) / segs.length;
    return f > toFraction(-6) ? BAD : f > toFraction(-18) ? WARN : OK;
  });
  // Unlit: the zone color at 20 % over the meter background; the held peak is off-white (framework).
  const unlit = zones.map((z) => `color-mix(in oklab, ${z} 20%, var(--color-meter-off))`);
  segs.forEach((s, i) => (s.style.background = unlit[i]));
  const meter = new PeakMeter();
  return (peakDb: number) => {
    const m = meter.update(peakDb, performance.now());
    const lit = Math.round(m.fraction * segs.length);
    const hold = Math.ceil(m.holdFraction * segs.length) - 1;
    segs.forEach((s, i) => (s.style.background = i === hold && m.holdFraction > 0 && i >= lit ? 'var(--color-text)' : i < lit ? zones[i] : unlit[i]));
  };
}
