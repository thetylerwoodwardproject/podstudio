/*
 * Lining up a track from another device with the host's. Ranges are on the
 * host's timeline; a track that started `shift` seconds later has that moment
 * `shift` seconds earlier in its own audio. Negative times are silence, which
 * rangesWav() fills in, so every track comes out the same length.
 */
import type { Range } from './assemble.ts';

export const alignedRanges = (ranges: Range[], shift: number): Range[] => (shift ? ranges.map(([a, b]) => [a - shift, b - shift] as Range) : ranges);
