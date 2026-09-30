import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peakChunk, sourcePeaks } from './editor-peaks.ts';

test('waveform peaks are read in bounded chunks and cached for later requests', async () => {
  const reads: [number, number][] = [];
  const reader = { channels: 1 as const, sampleRate: 100, async read(from: number, seconds: number) {
    reads.push([from, seconds]);
    return new Float32Array(Math.round(seconds * 100)).fill(from >= 10 ? .75 : .25);
  } };
  const chunks: { start: number; peaks: number[] }[] = [];
  await sourcePeaks('bounded-test-source', reader, 25, 0, 25, (chunk) => chunks.push(chunk));
  assert.deepEqual(reads, [[0, 10], [10, 10], [20, 5]]);
  assert.deepEqual(chunks.map((chunk) => [chunk.start, chunk.peaks.length, chunk.peaks[0]]), [[0, 20, .25], [20, 20, .75], [40, 10, .75]]);
  await sourcePeaks('bounded-test-source', reader, 25, 10, 20);
  assert.equal(reads.length, 3);
});

test('stereo peaks use the louder channel without changing source samples', async () => {
  const samples = new Float32Array(100).fill(0);
  samples[1] = -.9;
  const reader = { channels: 2 as const, sampleRate: 100, read: async () => samples };
  assert.ok(Math.abs((await peakChunk(reader, 0, .5))[0] - .9) < 1e-6);
  assert.ok(Math.abs(samples[1] + .9) < 1e-6);
});
