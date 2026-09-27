import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignedRanges, nudged } from './align.ts';

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

test('a nudge moves the guest later (+) or earlier (−), on top of the start-time shift', () => {
  const r = alignedRanges(nudged([[0, 60]], 38), 0.8);
  assert.ok(Math.abs(r[0][0] + 0.838) < 1e-9 && Math.abs(r[0][1] - 59.162) < 1e-9, JSON.stringify(r));
  assert.deepEqual(nudged([[10, 20]], -500), [[10.5, 20.5]]);
  const same: [number, number][] = [[1, 2]];
  assert.equal(nudged(same, 0), same);
});
