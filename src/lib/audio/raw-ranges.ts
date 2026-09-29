import { merge, onAudio, type Range } from './assemble.ts';
import type { TakeMeta } from './takes.ts';

export function rawRanges(host: TakeMeta): Range[] {
  const cuts = merge(onAudio(host.markers ?? [], host.lineLog ?? []).markers.filter((m) => m.kind === 'pause' && m.end != null && m.end > m.t).map((m) => [m.t, m.end!] as Range));
  const end = host.samples / host.sampleRate;
  const ranges: Range[] = []; let at = 0;
  for (const [a, b] of cuts) { if (a > at) ranges.push([at, Math.min(a, end)]); at = Math.max(at, b); }
  if (at < end) ranges.push([at, end]);
  return ranges;
}
