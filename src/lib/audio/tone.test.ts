import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANDS, COMP_PRESETS, EQ_PRESETS, ToneProcessor, cleanTone, compCurve, eqResponse, flatTone, matchToTarget, speechTarget, toneActive, type VoiceTone } from './tone.ts';

const rate = 48000;
const sine = (f: number, a: number, seconds: number) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / rate));
const rmsDb = (x: Float32Array, from = 0) => {
  let s = 0;
  for (let i = from; i < x.length; i++) s += x[i] * x[i];
  return 10 * Math.log10(s / (x.length - from));
};
const tone = (gains: number[], comp?: Partial<VoiceTone['comp']>): VoiceTone => ({
  eq: { on: true, gains, preset: null },
  comp: { ...flatTone().comp, ...comp },
});

test('flat, or everything off, leaves the audio exactly as it was', () => {
  const x = sine(440, 0.3, 0.5);
  const y = new ToneProcessor(rate, 1, flatTone()).process(x.slice());
  assert.deepEqual(y, x);
  assert.equal(toneActive(flatTone()), false);
  assert.equal(toneActive(tone([0, 0, 0, 0, 3, 0, 0, 0, 0, 0])), true);
});

test('a band boosts its own frequency by its gain, and leaves far ones alone', () => {
  const gains = [0, 0, 0, 0, 0, 6, 0, 0, 0, 0]; // +6 dB at 1 kHz
  assert.ok(Math.abs(eqResponse(1000, gains) - 6) < 0.05, String(eqResponse(1000, gains)));
  assert.ok(Math.abs(eqResponse(100, gains)) < 0.3);
  // And the filter itself does what the response says
  const x = sine(1000, 0.1, 1);
  const y = new ToneProcessor(rate, 1, tone(gains)).process(x.slice());
  assert.ok(Math.abs(rmsDb(y, rate / 2) - rmsDb(x, rate / 2) - 6) < 0.1);
});

test('the EQ streams: chunks give the same result as one go, per channel', () => {
  const l = sine(250, 0.2, 0.4), r = sine(3000, 0.2, 0.4);
  const x = new Float32Array(l.length * 2);
  for (let i = 0; i < l.length; i++) (x[2 * i] = l[i]), (x[2 * i + 1] = r[i]);
  const t = tone(EQ_PRESETS.Radio, { on: true, ...COMP_PRESETS.Heavy });
  const whole = new ToneProcessor(rate, 2, t).process(x.slice());
  const p = new ToneProcessor(rate, 2, t);
  const parts = [x.slice(0, 1234), x.slice(1234, 9000), x.slice(9000)].map((c) => p.process(c));
  const joined = new Float32Array(x.length);
  let o = 0;
  for (const c of parts) (joined.set(c, o), (o += c.length));
  for (let i = 0; i < x.length; i += 97) assert.ok(Math.abs(joined[i] - whole[i]) < 1e-6);
});

test('the compressor: below the knee untouched, above it by the ratio, plus make-up', () => {
  const c = { threshold: -20, ratio: 4, knee: 0 };
  assert.equal(compCurve(-30, c), -30);
  assert.equal(compCurve(-8, c), -17);
  // Soft knee: smooth through the threshold, and below the straight line
  const soft = { threshold: -20, ratio: 4, knee: 8 };
  assert.ok(compCurve(-20, soft) < -20 && compCurve(-20, soft) > -21);
  assert.equal(compCurve(-30, soft), -30);
  // On audio: a loud sine is turned down by about the ratio, then made up
  const loud = sine(1000, 10 ** (-6 / 20), 1);
  const y = new ToneProcessor(rate, 1, { eq: flatTone().eq, comp: { on: true, threshold: -20, ratio: 4, knee: 0, makeup: 3, preset: null } }).process(loud.slice());
  // Peak −6 dBFS: 14 dB over, so 10.5 dB of reduction, then +3
  assert.ok(Math.abs(rmsDb(y, rate / 2) - rmsDb(loud, rate / 2) - (-10.5 + 3)) < 0.5, String(rmsDb(y, rate / 2) - rmsDb(loud, rate / 2)));
});

test('match to target: a boomy voice gets its low-mids cut, within ±6 dB', () => {
  const boomy = (f: number) => speechTarget(f) + 6 * Math.exp(-((Math.log2(f / 200) / 0.8) ** 2));
  const g = matchToTarget(boomy);
  assert.equal(g.length, BANDS.length);
  assert.ok(g[3] <= -3, `250 Hz: ${g[3]}`);
  assert.ok(g.every((x) => Math.abs(x) <= 6));
  assert.ok(Math.abs(g[6]) <= 1 && Math.abs(g[7]) <= 1, 'the rest stays near flat');
  // A voice already on target needs nothing
  assert.ok(matchToTarget(speechTarget).every((x) => x === 0));
});

test('stored settings are cleaned up', () => {
  const t = cleanTone({ eq: { on: true, gains: [40, -40, 0.4, 0, 0, 0, 0, 0, 0, 0], preset: null }, comp: { on: true, threshold: 9, ratio: 0, knee: 3, makeup: 99, preset: 'Voice' } });
  assert.deepEqual(t.eq.gains.slice(0, 3), [12, -12, 0]);
  assert.equal(t.comp.threshold, 0);
  assert.equal(t.comp.ratio, 1);
  assert.equal(t.comp.makeup, 12);
  assert.deepEqual(cleanTone(undefined), flatTone());
  // Names from before the step flow
  assert.equal(t.comp.preset, 'Medium');
  assert.equal(cleanTone({ comp: { ...flatTone().comp, preset: 'Broadcast' } }).comp.preset, 'Heavy');
});
