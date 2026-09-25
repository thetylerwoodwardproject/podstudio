/*
 * Mixer view (Mixer View 1b) for host + guest ad-lib sessions: a lane per
 * person with the last minute of level, the zone they're in, and who's been
 * talking how much. Same zones as the mic check: target -18 to -6 dBFS.
 */

export type LaneStatus = 'HOT' | 'IN TARGET' | 'LOW' | 'IDLE';

/** Below this a person counts as not talking (the same threshold voice follow's watchdog uses). */
export const TALK_THRESHOLD = -40;
export const HISTORY_SECONDS = 60;

export function laneStatus(db: number): LaneStatus {
  if (!Number.isFinite(db) || db < TALK_THRESHOLD) return 'IDLE';
  if (db > -6) return 'HOT';
  if (db >= -18) return 'IN TARGET';
  return 'LOW';
}

/** Peak level per second for the last minute. */
export class LevelHistory {
  /** Oldest first; -Infinity for seconds with nothing */
  bars: number[] = Array(HISTORY_SECONDS).fill(-Infinity);
  private second = -1;

  push(db: number, t: number) {
    const s = Math.floor(t);
    if (this.second < 0) this.second = s;
    // Move on a bar per second passed (silence for seconds with no reading).
    while (this.second < s) {
      this.bars.push(-Infinity);
      this.bars.shift();
      this.second++;
    }
    const i = this.bars.length - 1;
    this.bars[i] = Math.max(this.bars[i], db);
  }
}

/** Seconds each person talked, and their shares. */
export class TalkTime {
  seconds: Record<string, number> = {};

  add(who: string, db: number, dt: number) {
    this.seconds[who] ??= 0;
    if (db >= TALK_THRESHOLD) this.seconds[who] += dt;
  }

  /** Whole-number percentages that add up to 100 (or all 0 before anyone talks). */
  shares(): Record<string, number> {
    const names = Object.keys(this.seconds);
    const total = names.reduce((n, k) => n + this.seconds[k], 0);
    const out: Record<string, number> = {};
    if (!total) {
      for (const k of names) out[k] = 0;
      return out;
    }
    let given = 0;
    names.forEach((k, i) => {
      out[k] = i === names.length - 1 ? 100 - given : Math.round((this.seconds[k] / total) * 100);
      given += out[k];
    });
    return out;
  }
}
