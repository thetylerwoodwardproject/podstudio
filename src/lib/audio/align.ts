/*
 * Lining up a track from another device with the host's. Ranges are on the
 * host's timeline; a track that started `shift` seconds later has that moment
 * `shift` seconds earlier in its own audio. Negative times are silence, which
 * rangesWav() fills in, so every track comes out the same length.
 */
import type { Range } from './assemble.ts';

export const alignedRanges = (ranges: Range[], shift: number): Range[] => (shift ? ranges.map(([a, b]) => [a - shift, b - shift] as Range) : ranges);

/**
 * A guest nudged by hand (Wrapping up → Line up): `ms` later (+) or earlier
 * (−) against the host. The host's ranges move back by that much before
 * they're mapped onto the guest's audio, so the guest's words land later.
 */
export const nudged = (ranges: Range[], ms = 0): Range[] => (ms ? ranges.map(([a, b]) => [a - ms / 1000, b - ms / 1000] as Range) : ranges);
