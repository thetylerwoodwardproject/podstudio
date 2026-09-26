import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR, detentBetween, faderPos, slideLevel } from './pad-fader.ts';

test('the fader spans the floor to 0 dB, or to the saved level when that is higher', () => {
  assert.equal(faderPos(FLOOR, -6), 0);
  assert.equal(faderPos(0, -6), 1);
  assert.equal(faderPos(-20, -6), 0.5);
  assert.equal(faderPos(4, 4), 1);
  assert.equal(faderPos(-80, 0), 0);
});

test('sliding moves from where the level was, in whole dB, and stops at the ends', () => {
  assert.equal(slideLevel(-20, 0, 400, -6), -20);
  assert.equal(slideLevel(-20, -100, 400, -6), -30);
  assert.equal(slideLevel(-20, 1000, 400, -12), 0);
  assert.equal(slideLevel(-20, -1000, 400, -12), FLOOR);
  assert.equal(slideLevel(-20, 33, 400, -12), -17);
});

test('it snaps to 0 dB and to the saved level', () => {
  assert.equal(slideLevel(-20, 76, 400, -12), -12); // −12.4 → the saved level
  assert.equal(slideLevel(-10, 95, 400, -12), 0); // −0.5 → 0 dB
  assert.equal(slideLevel(-20, 50, 400, -12), -15);
});

test('a tick when a slide lands on or passes a detent', () => {
  assert.equal(detentBetween(-15, -10, -12), -12);
  assert.equal(detentBetween(-15, -12, -12), -12);
  assert.equal(detentBetween(-3, 0, -12), 0);
  assert.equal(detentBetween(-20, -18, -12), null);
  assert.equal(detentBetween(-12, -12, -12), null);
});
