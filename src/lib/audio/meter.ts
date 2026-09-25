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

/**
 * Drive a row of meter segments from peak levels: coloured by zone, with a fast
 * attack and a slow release like a hardware meter.
 */
export function segmentMeter(segs: HTMLElement[]) {
  // Each segment's zone is the level at its top edge.
  const zones = segs.map((_, i) => {
    const f = (i + 1) / segs.length;
    return f > toFraction(-6) ? BAD : f > toFraction(-18) ? WARN : OK;
  });
  const unlit = zones.map((z) => `color-mix(in oklab, ${z} 20%, var(--color-line))`);
  segs.forEach((s, i) => (s.style.background = unlit[i]));
  let shown = 0;
  return (peakDb: number) => {
    const target = toFraction(peakDb) * segs.length;
    shown = target > shown ? target : Math.max(target, shown - 0.6);
    segs.forEach((s, i) => (s.style.background = i < Math.round(shown) ? zones[i] : unlit[i]));
  };
}
