import test from 'node:test';
import assert from 'node:assert/strict';
import { rawRanges } from './raw-ranges.ts';
import type { TakeMeta } from './takes.ts';
const host = (markers: TakeMeta['markers'] = []) => ({ samples: 480000, sampleRate: 48000, markers } as TakeMeta);
test('raw review retains retakes and coughs but removes recorded pause intervals', () => {
  assert.deepEqual(rawRanges(host([{ t: 1, kind: 'retake' }, { t: 2, end: 3, kind: 'cut' }, { t: 4, end: 7, kind: 'pause' }])), [[0, 4], [7, 10]]);
});
test('coordinated pauses already omitted from samples are not cut twice', () => {
  assert.deepEqual(rawRanges(host([{ t: 4, end: 7, kind: 'pause', recorded: false }])), [[0, 10]]);
});
