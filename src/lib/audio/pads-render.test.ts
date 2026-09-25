import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PadRenderer, roughMix, wallTime, type PadLog, type PadPress } from './pads-render.ts';
import type { SessionMarker } from './assemble.ts';

const RATE = 1000;
const duck = { attackMs: 10, releaseMs: 50, threshold: -40 };
/** A file of constant 0.5 on both channels, `seconds` long */
const flat = (seconds: number) => ({ rate: RATE, data: new Float32Array(seconds * RATE * 2).fill(0.5) });
const press = (p: Partial<PadPress>): PadPress => ({
  t: 0, key: 1, padId: 'p1', name: 'Sting', color: 'teal', fileId: 'f', mode: 'oneshot',
  gainDb: 0, fadeInMs: 0, fadeOutMs: 0, trimStart: 0, trimEnd: 0, duck: false, duckDb: 12, ...p,
});
const render = (log: PadLog, seconds: number, mic = new Float32Array(seconds * RATE), markers: SessionMarker[] = [], files = { f: flat(2) }) =>
  new PadRenderer(log, new Map(Object.entries(files)), RATE, markers, duck).render(mic);
const firstSound = (x: Float32Array) => x.findIndex((v) => Math.abs(v) > 1e-6) / 2;

test('a press starts at its time to the sample', () => {
  const out = render({ presses: [press({ t: 3.4 })], volume: [] }, 6);
  assert.equal(firstSound(out), 3400);
  assert.ok(Math.abs(out[2 * 3500] - 0.5) < 1e-6);
  // A 2 s one-shot is over by 5.4 s.
  assert.equal(out[2 * 5500], 0);
});

test('a loop plays until stopped, then fades', () => {
  const out = render({ presses: [press({ mode: 'loop', stop: 5, stopFade: 1 })], volume: [] }, 8);
  assert.ok(Math.abs(out[2 * 4500] - 0.5) < 1e-6, 'still looping after the file ends');
  assert.ok(Math.abs(out[2 * 5500] - 0.25) < 0.01, 'halfway through the fade');
  assert.equal(out[2 * 6100], 0);
});

test('a hold stops at release', () => {
  const out = render({ presses: [press({ mode: 'hold', stop: 1, stopFade: 0.15 })], volume: [] }, 3);
  assert.ok(out[2 * 900] > 0.4);
  assert.equal(out[2 * 1200], 0);
});

test('only pads set to duck go under the voice', () => {
  const mic = new Float32Array(3000);
  mic.fill(0.3, 1000, 2000);
  const both = render({ presses: [press({ duck: true, duckDb: 12 })], volume: [] }, 3, mic);
  const dry = render({ presses: [press({ duck: false })], volume: [] }, 3, mic);
  assert.ok(Math.abs(both[2 * 1500] - 0.5 * 10 ** (-12 / 20)) < 0.01, 'ducked 12 dB while talking');
  assert.ok(Math.abs(both[2 * 500] - 0.5) < 1e-6, 'full level before');
  assert.ok(Math.abs(dry[2 * 1500] - 0.5) < 1e-6);
});

test('pads volume changes apply from their time', () => {
  const out = render({ presses: [press({ mode: 'loop' })], volume: [{ t: 0, db: 0 }, { t: 1, db: -6 }] }, 2);
  assert.ok(Math.abs(out[2 * 500] - 0.5) < 1e-6);
  assert.ok(Math.abs(out[2 * 1500] - 0.5 * 10 ** (-6 / 20)) < 1e-3);
});

test('a gap in the mic removes the same stretch from the pads', () => {
  // The mic stopped from 1 s to 3 s on the wall clock: audio 1 s is wall 3 s.
  const markers: SessionMarker[] = [{ t: 1, kind: 'gap', line: 0, end: 3 }];
  assert.equal(wallTime(0.5, [[1, 3]]), 0.5);
  assert.equal(wallTime(1.5, [[1, 3]]), 3.5);
  const out = render({ presses: [press({ t: 3.2 })], volume: [] }, 3, undefined, markers);
  assert.equal(firstSound(out), 1200);
});

test('the rough mix stays under -1 dBFS', () => {
  const mic = new Float32Array(100).fill(0.9);
  const pads = new Float32Array(200).fill(0.5);
  const out = roughMix(mic, 1, pads, { g: 1 }, RATE);
  assert.ok(Math.max(...out) <= 10 ** (-1 / 20) + 1e-6);
});

test('a level ride changes the pad from its time', () => {
  const out = render({ presses: [press({ mode: 'loop', levels: [{ t: 1, db: -20 }] })], volume: [] }, 2);
  assert.ok(Math.abs(out[2 * 500] - 0.5) < 1e-6);
  assert.ok(Math.abs(out[2 * 1500] - 0.05) < 1e-3);
});
