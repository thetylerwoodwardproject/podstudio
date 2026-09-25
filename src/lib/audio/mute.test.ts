import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMute, splitByMutes } from './mute.ts';

test('a mute is silent in the middle and fades at both edges', () => {
  const x = new Float32Array(100).fill(1);
  applyMute(x, 1, 0, 20, 60, 10);
  assert.equal(x[10], 1, 'before');
  assert.equal(x[20], 1, 'starts at full level');
  assert.ok(x[25] > 0.4 && x[25] < 0.6, 'halfway down the fade');
  assert.equal(x[40], 0, 'silent');
  assert.ok(x[57] > 0 && x[57] < 1, 'coming back');
  assert.equal(x[70], 1, 'after');
});

test('stereo frames and an offset start', () => {
  const x = new Float32Array(40).fill(1);
  applyMute(x, 2, 100, 105, 115, 0);
  assert.deepEqual([x[8], x[9], x[10], x[11]], [1, 1, 0, 0]);
  assert.deepEqual([x[28], x[29], x[30], x[31]], [0, 0, 1, 1]);
});

test('ranges split around mutes', () => {
  assert.deepEqual(splitByMutes(0, 10, [[2, 4], [8, 12]]), [
    { a: 0, b: 2, muted: false },
    { a: 2, b: 4, muted: true },
    { a: 4, b: 8, muted: false },
    { a: 8, b: 10, muted: true },
  ]);
  assert.deepEqual(splitByMutes(0, 10, []), [{ a: 0, b: 10, muted: false }]);
});
