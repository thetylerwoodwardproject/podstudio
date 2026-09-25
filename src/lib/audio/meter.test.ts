import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAD, OK, WARN, toFraction, verdict, zone } from './meter.ts';

test('scale: -60, -24, -12, -6 and 0 dBFS evenly spaced; -18 at 37.5 %', () => {
  assert.deepEqual([-60, -24, -12, -6, 0].map(toFraction), [0, 0.25, 0.5, 0.75, 1]);
  assert.equal(toFraction(-18), 0.375);
  assert.equal(toFraction(-Infinity), 0);
});

test('standard traffic-light zones', () => {
  assert.equal(zone(-30), OK);
  assert.equal(zone(-18), WARN);
  assert.equal(zone(-6), WARN);
  assert.equal(zone(-5.9), BAD);
});

test('what the person is told', () => {
  assert.equal(verdict(-11)[0], 'Right on target');
  assert.equal(verdict(-15)[0], 'In the target zone');
  assert.equal(verdict(-18.4)[0], 'In the target zone', 'shown as -18');
  assert.equal(verdict(-20)[0], 'A little low · turn the gain up a touch');
  assert.equal(verdict(-30)[0], 'Low · turn the gain up');
  assert.equal(verdict(-4)[0], 'Too hot · turn the gain down');
  // In the target zone is good; low and hot are flagged.
  assert.deepEqual([verdict(-11)[2], verdict(-30)[2], verdict(-4)[2]], [OK, WARN, BAD]);
});
