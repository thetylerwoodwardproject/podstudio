/*
 * The fader a playing pad grows into on a phone (Hotkey Pads 2c): slide to
 * ride its level. The whole strip's width spans FLOOR dB to 0 dB (or the pad's
 * saved level, if that's higher); the level moves with the finger from where
 * it was, so nothing jumps when the fader appears. It clicks into 0 dB and
 * the pad's saved level as you pass them.
 */

export const FLOOR = -40;
/** How close (dB) a slide has to come to a detent to snap to it */
export const SNAP = 1;

export const faderTop = (savedDb: number) => Math.max(0, savedDb);

/** Where a level sits along the fader, 0 to 1. */
export function faderPos(db: number, savedDb: number): number {
  const top = faderTop(savedDb);
  return Math.min(1, Math.max(0, (db - FLOOR) / (top - FLOOR)));
}

/**
 * The level after sliding `dx` of the fader's `width` from a start level, in
 * whole dB, snapped to 0 dB and the saved level when within SNAP of them.
 */
export function slideLevel(startDb: number, dx: number, width: number, savedDb: number): number {
  const top = faderTop(savedDb);
  const raw = Math.min(top, Math.max(FLOOR, startDb + (dx / width) * (top - FLOOR)));
  for (const detent of [0, savedDb]) if (Math.abs(raw - detent) <= SNAP) return detent;
  return Math.round(raw);
}

/** A detent crossed or landed on going from `a` to `b` (for the tick), or null. */
export function detentBetween(a: number, b: number, savedDb: number): number | null {
  if (a === b) return null;
  for (const d of [0, savedDb]) if (b === d || (a - d) * (b - d) < 0) return d;
  return null;
}
