import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peakChunk, sourcePeaks, waveformBars } from './editor-peaks.ts';

test('waveform peaks are read in bounded chunks and cached for later requests', async () => {
  const reads: [number, number][] = [];
  const reader = { channels: 1 as const, sampleRate: 100, async read(from: number, seconds: number) {
    reads.push([from, seconds]);
    return new Float32Array(Math.round(seconds * 100)).fill(from >= 10 ? .75 : .25);
  } };
  const chunks: { start: number; peaks: number[] }[] = [];
  await sourcePeaks('bounded-test-source', reader, 25, 0, 25, (chunk) => chunks.push(chunk));
  assert.deepEqual(reads, [[0, 10], [10, 10], [20, 5]]);
  assert.deepEqual(chunks.map((chunk) => [chunk.start, chunk.peaks.length, chunk.peaks[0]]), [[0, 500, .25], [500, 500, .75], [1000, 250, .75]]);
  await sourcePeaks('bounded-test-source', reader, 25, 10, 20);
  assert.equal(reads.length, 3);
});

test('waveform shape is stable across clip splits and follows source time', () => {
  const peaks = Array.from({ length: 500 }, (_, i) => i % 100 < 30 ? .64 : .04);
  const whole = waveformBars(peaks, 0, 10, 20, 0, 10);
  const left = waveformBars(peaks, 0, 5, 20, 0, 5);
  const right = waveformBars(peaks, 5, 10, 20, 5, 10);
  assert.deepEqual(left, whole.filter((bar) => bar.left < 100));
  assert.deepEqual(right.map((bar) => [Math.round((bar.left + 100) * 1000), bar.height]), whole.filter((bar) => bar.left >= 99).map((bar) => [Math.round(bar.left * 1000), bar.height]));
});

test('stereo peaks use the louder channel without changing source samples', async () => {
  const samples = new Float32Array(100).fill(0);
  samples[1] = -.9;
  const reader = { channels: 2 as const, sampleRate: 100, read: async () => samples };
  assert.ok(Math.abs((await peakChunk(reader, 0, .5))[0] - .9) < 1e-6);
  assert.ok(Math.abs(samples[1] + .9) < 1e-6);
});
