import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curvePath, dbLabel, dbLines, dbPos, freqGrid, freqLabel, freqPos, spectrumPoints } from './graph.ts';

test('the frequency axis is logarithmic from 20 Hz to 20 kHz', () => {
  assert.equal(freqPos(20), 0);
  assert.equal(freqPos(20000), 1);
  assert.ok(Math.abs(freqPos(632.46) - 0.5) < 1e-4);
  assert.ok(Math.abs(freqPos(200) - freqPos(20) - (freqPos(2000) - freqPos(200))) < 1e-9, 'every decade is the same width');
  assert.equal(freqPos(5), 0);
  assert.equal(freqPos(40000), 1);
});

test('the level axis runs ±24 with a line every 6 dB', () => {
  assert.equal(dbPos(24), 0);
  assert.equal(dbPos(0), 0.5);
  assert.equal(dbPos(-24), 1);
  assert.equal(dbPos(-40), 1);
  assert.deepEqual(dbLines(), [24, 18, 12, 6, 0, -6, -12, -18, -24]);
  assert.deepEqual([18, 0, -6].map(dbLabel), ['+18', '0', '−6']);
});

test('grid: 1-2-5 majors, the other steps minor', () => {
  const { major, minor } = freqGrid();
  assert.deepEqual(major, [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]);
  assert.ok(minor.includes(30) && minor.includes(700) && minor.includes(9000) && !minor.includes(20) && !minor.includes(10));
  assert.deepEqual([50, 1000, 10000].map(freqLabel), ['50', '1k', '10k']);
});

test('curves are paths left to right in the plot', () => {
  assert.equal(curvePath([[20000, -24], [20, 24]], 100, 50), 'M0.0 0.0 L100.0 50.0');
  assert.equal(curvePath([], 100, 50), '');
});

test('a spectrum is bucketed on the log axis with its peak at the top line', () => {
  const bins = Float32Array.from({ length: 1024 }, (_, i) => (i === 43 ? -10 : -60)); // a peak near 1 kHz at 48 kHz
  const pts = spectrumPoints(bins, 48000, 80, 18);
  assert.ok(pts.length > 40 && pts.length <= 80);
  const top = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
  assert.equal(top[1], 18);
  assert.ok(top[0] > 800 && top[0] < 1200, String(top[0]));
});
