import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignedRanges } from './align.ts';

test('a guest who started 0.8 s late is padded with 0.8 s of silence', () => {
  assert.deepEqual(alignedRanges([[0, 60]], 0.8), [[-0.8, 59.2]]);
});

test('a guest who started early is trimmed', () => {
  assert.deepEqual(alignedRanges([[0, 60]], -0.5), [[0.5, 60.5]]);
});

test('edit ranges shift together and keep their lengths', () => {
  const r = alignedRanges([[0, 10], [15, 30]], 0.25);
  assert.deepEqual(r, [[-0.25, 9.75], [14.75, 29.75]]);
});

test('no shift, same ranges', () => {
  const r: [number, number][] = [[1, 2]];
  assert.equal(alignedRanges(r, 0), r);
});
