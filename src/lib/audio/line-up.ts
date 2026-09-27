/*
 * Where every track of a session sits on the host's timeline: a guest's
 * track through its sync points (drift and gaps corrected, lib/audio/sync.ts)
 * or, for older tracks, its start time; then any nudge made by hand in
 * Wrapping up. Export, its preview and the wrap-up's Line up all use this.
 */
import { alignedRanges, nudged } from './align';
import { guestRanges, guestTime, type SyncMap } from './sync';
import { trackShift, trackSync, type TakeMeta } from './takes';
import type { Range } from './assemble';

export function lineUp(host: TakeMeta) {
  const syncs = new Map<TakeMeta, SyncMap | null>();
  const syncOf = (t: TakeMeta) => {
    if (!syncs.has(t)) syncs.set(t, t === host ? null : trackSync(t, host));
    return syncs.get(t)!;
  };
  const nudge = (t: TakeMeta) => (t === host ? 0 : (t.nudgeMs ?? 0));
  const secs = (x: number) => (x < 10 ? x.toFixed(1) : String(Math.round(x))).replace('-', '−');
  return {
    syncOf,
    /** What was done to line a track up, in a few words: "12 ms of drift corrected (+4 ppm), nudged +38 ms by hand". */
    describe(t: TakeMeta): string {
      const m = syncOf(t);
      const parts = !m
        ? ['lined up by start time only (recorded before sync points existed)']
        : [m.driftMs >= 1 ? `${Math.round(m.driftMs)} ms of drift corrected (${m.ppm > 0 ? '+' : '−'}${Math.abs(m.ppm).toFixed(0)} ppm)` : 'no measurable drift'];
      if (m && m.gaps >= 0.05) parts.push(`${secs(m.gaps)} s of missing audio filled with silence`);
      if (m && m.dropped >= 0.05) parts.push(`${secs(m.dropped)} s left out while your mic was stopped`);
      const n = nudge(t);
      if (n) parts.push(`nudged ${n > 0 ? '+' : '−'}${Math.abs(n)} ms by hand`);
      return parts.join(', ');
    },
    /** Host-timeline ranges as ranges of the track's own audio, for rangesWav() (silence where it has none). */
    ranges(t: TakeMeta, ranges: Range[]): Range[] {
      const r = nudged(ranges, nudge(t));
      const m = syncOf(t);
      return m ? guestRanges(m, r, host.sampleRate, t.sampleRate) : alignedRanges(r, trackShift(t, host));
    },
    /** Host-timeline ranges in the track's own seconds (for muting its coughs); ones it didn't record are dropped. */
    own(t: TakeMeta, ranges: Range[]): Range[] {
      const r = nudged(ranges, nudge(t));
      const m = syncOf(t);
      if (!m) return alignedRanges(r, trackShift(t, host));
      return r.flatMap(([a, b]) => {
        const ga = guestTime(m, a, host.sampleRate, t.sampleRate);
        const gb = guestTime(m, b, host.sampleRate, t.sampleRate);
        return ga != null && gb != null ? [[ga, gb] as Range] : [];
      });
    },
  };
}
