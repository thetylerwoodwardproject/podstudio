import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LevelHistory, TalkTime, laneStatus } from './mixer.ts';

test('lane status follows the mic check zones', () => {
  assert.equal(laneStatus(-3), 'HOT');
  assert.equal(laneStatus(-6), 'IN TARGET');
  assert.equal(laneStatus(-18), 'IN TARGET');
  assert.equal(laneStatus(-30), 'LOW');
  assert.equal(laneStatus(-50), 'IDLE');
  assert.equal(laneStatus(-Infinity), 'IDLE');
});

test('history keeps the peak of each second for a minute', () => {
  const h = new LevelHistory();
  h.push(-20, 10.1);
  h.push(-12, 10.6);
  h.push(-30, 11.2);
  assert.deepEqual(h.bars.slice(-2), [-12, -30]);
  h.push(-10, 14.0);
  assert.deepEqual(h.bars.slice(-4), [-30, -Infinity, -Infinity, -10]);
  assert.equal(h.bars.length, 60);
});

test('talk time shares add up to 100', () => {
  const t = new TalkTime();
  for (let i = 0; i < 58; i++) t.add('Tyler', -12, 1);
  for (let i = 0; i < 42; i++) t.add('Sam', -15, 1);
  t.add('Sam', -55, 10);
  assert.deepEqual(t.shares(), { Tyler: 58, Sam: 42 });
  assert.deepEqual(new TalkTime().shares(), {});
});
