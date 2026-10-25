// Chunk bookkeeping for recordings, pure so it can be tested without a database.
export interface ChunkInfo {
  sequence: number;
  firstSample: number;
  sampleCount: number;
}

export interface ChunkAnalysis {
  /** Chunks 0..n-1 that are present and whose sample positions line up with no gap. */
  prefixChunks: number;
  prefixSamples: number;
  /** Runs of missing sequence numbers (inclusive). */
  gaps: { fromSequence: number; toSequence: number }[];
  /** Sequences present but whose first-sample doesn't continue the previous chunk. */
  misaligned: number[];
  totalChunks: number;
  /** Everything present, in order, aligned. */
  complete: boolean;
}

export function analyseChunks(rows: ChunkInfo[]): ChunkAnalysis {
  const sorted = [...rows].sort((a, b) => a.sequence - b.sequence);
  const gaps: ChunkAnalysis["gaps"] = [];
  const misaligned: number[] = [];
  let expectSeq = 0;
  let expectSample = 0;
  let prefixChunks = 0;
  let prefixSamples = 0;
  let inPrefix = true;
  for (const c of sorted) {
    if (c.sequence > expectSeq) {
      gaps.push({ fromSequence: expectSeq, toSequence: c.sequence - 1 });
      inPrefix = false;
      expectSample = c.firstSample; // after a gap, only check continuity from here
    } else if (c.firstSample !== expectSample) {
      misaligned.push(c.sequence);
      inPrefix = false;
    }
    if (inPrefix) {
      prefixChunks++;
      prefixSamples += c.sampleCount;
    }
    expectSeq = c.sequence + 1;
    expectSample = c.firstSample + c.sampleCount;
  }
  return { prefixChunks, prefixSamples, gaps, misaligned, totalChunks: sorted.length, complete: gaps.length === 0 && misaligned.length === 0 };
}
