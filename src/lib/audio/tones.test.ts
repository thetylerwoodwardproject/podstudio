import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TONE_SECONDS, defaultTones, duckGains, mixTones, toneWindows } from './tones.ts';

const rate = 48000;
const db = (g: number) => 20 * Math.log10(g);
// Silence for 1 s, voice (-12 dBFS tone) for 1 s, silence for 1 s.
const voice = Float32Array.from({ length: rate * 3 }, (_, i) => (i >= rate && i < 2 * rate ? 0.25 * Math.sin(i / 3) : 0));

test('the tone ducks under the voice with the attack time, and comes back with the release', () => {
  const g = duckGains(voice, rate, { duck: 12, attackMs: 10, releaseMs: 150, threshold: -40 });
  assert.equal(g[rate - 100], 1, 'full level before speech');
  // Three attack time constants (30 ms), plus the 5 ms level window: about 95 % of the way.
  assert.ok(db(g[rate + Math.round(0.035 * rate)]) < -11, `${db(g[rate + 1680]).toFixed(1)} dB at 35 ms`);
  assert.ok(Math.abs(db(g[rate + rate / 2]) + 12) < 0.01, 'held at -12 dB while talking');
  // One release time constant after speech stops: 63 % of the way back (about -2.7 dB); five: nearly all.
  const oneRelease = db(g[2 * rate + Math.round(0.155 * rate)]);
  assert.ok(oneRelease > -3.5 && oneRelease < -2, `${oneRelease.toFixed(2)} dB`);
  assert.ok(db(g[2 * rate + Math.round(0.755 * rate)]) > -0.1);
});

test('a slower attack ducks later', () => {
  const fast = duckGains(voice, rate, { duck: 12, attackMs: 5, releaseMs: 150, threshold: -40 });
  const slow = duckGains(voice, rate, { duck: 12, attackMs: 80, releaseMs: 150, threshold: -40 });
  const at = rate + Math.round(0.04 * rate);
  assert.ok(slow[at] > fast[at] + 0.2);
});

test('no ducking at 0 dB', () => {
  const g = duckGains(voice, rate, { duck: 0, attackMs: 10, releaseMs: 150, threshold: -40 });
  assert.ok(g.every((v) => Math.abs(v - 1) < 1e-9));
});

test('tones land on their sample, at their level, and nothing else changes', () => {
  const x = new Float32Array(rate * 2); // silence
  const out = mixTones(x, 1, rate, 0, [{ at: rate, kind: 'retake' }], defaultTones);
  const first = out.findIndex((v) => v !== 0);
  assert.equal(first, rate + 1, 'starts on the marker (after its 0 first sample)');
  let peak = 0;
  for (let i = rate; i < rate + TONE_SECONDS * rate; i++) peak = Math.max(peak, Math.abs(out[i]));
  assert.ok(Math.abs(db(peak) - defaultTones.level) < 0.1, `${db(peak).toFixed(2)} dBFS`);
  assert.ok(out.slice(rate + TONE_SECONDS * rate + 1).every((v) => v === 0));
});

test('over the voice the tone is quieter by the duck amount', () => {
  const quiet = mixTones(new Float32Array(rate), 1, rate, 0, [{ at: rate / 2, kind: 'retake' }], defaultTones);
  const loud = Float32Array.from({ length: rate }, (_, i) => 0.25 * Math.sin(i / 3));
  const under = mixTones(loud, 1, rate, 0, [{ at: rate / 2, kind: 'retake' }], defaultTones);
  // What the tone added over the voice, against what it added alone.
  let a = 0, b = 0;
  for (let i = rate / 2 + 2400; i < rate / 2 + 7200; i++) {
    a += quiet[i] ** 2;
    b += (under[i] - loud[i]) ** 2;
  }
  assert.ok(Math.abs(10 * Math.log10(b / a) + 12) < 0.5, `${(10 * Math.log10(b / a)).toFixed(2)} dB`);
});

test('stereo gets the tone on both sides', () => {
  const out = mixTones(new Float32Array(rate * 2), 2, rate, 0, [{ at: 100, kind: 'cut' }], defaultTones);
  assert.equal(out[(100 + 50) * 2], out[(100 + 50) * 2 + 1]);
  assert.notEqual(out[(100 + 50) * 2], 0);
});

test('windows cover the pre-roll and merge when they overlap', () => {
  const w = toneWindows([{ at: 48000, kind: 'retake' }, { at: 60000, kind: 'retake' }, { at: 480000, kind: 'cut' }], rate, 500000);
  assert.equal(w.length, 2);
  assert.deepEqual([w[0].from, w[0].to, w[0].tones.length], [24000, 60000 + 9600, 2]);
  assert.equal(w[1].to, 489600);
});
