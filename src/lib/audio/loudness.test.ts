import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Leveler, LoudnessMeter, TruePeakLimiter } from './loudness.ts';

const sine = (rate: number, seconds: number, dbfs: number, channels = 2, freq = 1000) => {
  const a = 10 ** (dbfs / 20);
  const n = Math.round(rate * seconds);
  const x = new Float32Array(n * channels);
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) x[i * channels + c] = a * Math.sin((2 * Math.PI * freq * i) / rate);
  return x;
};
const measure = (x: Float32Array, rate: number, channels: number, chunk = 12345) => {
  const m = new LoudnessMeter(rate, channels);
  for (let i = 0; i < x.length; i += chunk * channels) m.push(x.subarray(i, i + chunk * channels));
  return m.integrated();
};

test('EBU Tech 3341: a 1 kHz stereo sine at −23 dBFS reads −23 LUFS', () => {
  for (const rate of [44100, 48000]) {
    assert.ok(Math.abs(measure(sine(rate, 20, -23), rate, 2) + 23) < 0.1, `${rate}: ${measure(sine(rate, 20, -23), rate, 2)}`);
    assert.ok(Math.abs(measure(sine(rate, 20, -33), rate, 2) + 33) < 0.1);
  }
});

test('mono reads 3 dB below the same signal in stereo', () => {
  const l = measure(sine(48000, 10, -20, 1), 48000, 1);
  assert.ok(Math.abs(l + 23.01) < 0.15, String(l));
});

test('gating: silence around the programme leaves integrated loudness alone', () => {
  const rate = 48000;
  const tone = sine(rate, 30, -23);
  const x = new Float32Array(tone.length * 2);
  x.set(tone, tone.length / 2);
  assert.ok(Math.abs(measure(x, rate, 2) + 23) < 0.2, String(measure(x, rate, 2)));
});

/** Independent true-peak check: 16× windowed-sinc interpolation with 64 taps. */
function truePeak16(x: Float32Array, channels: number) {
  let peak = 0;
  const frames = x.length / channels;
  for (let c = 0; c < channels; c++)
    for (let f = 32; f < frames - 32; f++) {
      for (let p = 0; p < 16; p++) {
        const frac = p / 16;
        let y = 0;
        for (let k = -31; k <= 32; k++) {
          const t = k - frac;
          const s = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
          const w = 0.5 + 0.5 * Math.cos((Math.PI * t) / 33);
          y += s * w * x[(f + k) * channels + c];
        }
        peak = Math.max(peak, Math.abs(y));
      }
    }
  return peak;
}

test('true-peak limiter: nothing over −1 dBTP, same length, quiet parts untouched', () => {
  const rate = 48000;
  // Quiet, then a hot stretch with inter-sample peaks (a sine near fs/4, phase-shifted), then quiet.
  const quiet = sine(rate, 0.5, -20, 2, 440);
  const hot = sine(rate, 0.5, 2, 2, 11025.5);
  const x = new Float32Array(quiet.length * 2 + hot.length);
  x.set(quiet, 0);
  x.set(hot, quiet.length);
  x.set(quiet, quiet.length + hot.length);
  const lim = new TruePeakLimiter(rate, 2, -1);
  const parts: Float32Array[] = [];
  for (let i = 0; i < x.length; i += 1000 * 2) parts.push(lim.process(x.subarray(i, i + 2000)));
  parts.push(lim.flush());
  const y = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    y.set(p, o);
    o += p.length;
  }
  assert.equal(y.length, x.length, 'same length out');
  const tp = 20 * Math.log10(truePeak16(y, 2));
  assert.ok(tp <= -0.9, `true peak ${tp.toFixed(2)} dBTP`);
  // The first quiet stretch (before the lookahead reaches the hot part) is unchanged.
  for (let i = 0; i < quiet.length - 2 * 2000; i++) assert.ok(Math.abs(y[i] - x[i]) < 1e-6);
});

const noise = (rate: number, seconds: number, dbfs: number, seed = 1) => {
  let s = seed;
  const a = 10 ** (dbfs / 20) * Math.sqrt(3);
  return Float32Array.from({ length: Math.round(rate * seconds) }, () => ((s = (s * 16807) % 2147483647) / 2147483647 * 2 - 1) * a);
};
const rms = (x: Float32Array) => 10 * Math.log10(x.reduce((n, v) => n + v * v, 0) / x.length);

test('leveler: a quiet and a loud voice come out within 3 dB of each other', () => {
  const rate = 16000;
  const quietVoice = noise(rate, 20, -35, 3);
  const loudVoice = noise(rate, 20, -15, 4);
  const lv = new Leveler(rate, 1);
  const q = lv.process(quietVoice).subarray(rate * 15);
  const l = lv.process(loudVoice).subarray(rate * 15);
  assert.ok(Math.abs(rms(q) - rms(l)) < 3, `${rms(q).toFixed(1)} vs ${rms(l).toFixed(1)} dB`);
});

test('leveler: room noise and silence are not pushed up', () => {
  const rate = 16000;
  const lv = new Leveler(rate, 1);
  const room = noise(rate, 20, -60, 5);
  const out = lv.process(room);
  assert.ok(rms(out) < -59, `room noise came out at ${rms(out).toFixed(1)} dB`);
  const silent = lv.process(new Float32Array(rate));
  assert.ok(silent.every((v) => v === 0));
});

test('leveler and meter give the same result in chunks as in one go', () => {
  const rate = 16000;
  const x = noise(rate, 6, -30, 7);
  const whole = new Leveler(rate, 1).process(x);
  const lv = new Leveler(rate, 1);
  const pieces = [x.subarray(0, 777), x.subarray(777, 50000), x.subarray(50000)].map((p) => lv.process(p));
  const joined = new Float32Array(x.length);
  let o = 0;
  for (const p of pieces) {
    joined.set(p, o);
    o += p.length;
  }
  for (let i = 0; i < x.length; i += 997) assert.ok(Math.abs(joined[i] - whole[i]) < 1e-7);
});

test('short-term history and loudness range', () => {
  const rate = 48000;
  // 20 s at −20 dBFS, then 20 s at −30 dBFS (a 10 dB step), stereo
  const x = new Float32Array(rate * 40 * 2);
  for (let i = 0; i < rate * 40; i++) {
    const a = 10 ** ((i < rate * 20 ? -20 : -30) / 20);
    x[2 * i] = x[2 * i + 1] = a * Math.sin((2 * Math.PI * 1000 * i) / rate);
  }
  const m = new LoudnessMeter(rate, 2);
  m.push(x);
  const h = m.shortTerm(1);
  assert.equal(h.length, 40);
  assert.equal(h[1], -Infinity, 'nothing until 3 s in');
  assert.ok(Math.abs(h[10] - -20) < 0.2 && Math.abs(h[35] - -30) < 0.2, `${h[10]} ${h[35]}`);
  const lra = m.range()!;
  assert.ok(Math.abs(lra - 10) < 0.6, `range ${lra}`);
  // A steady tone has almost no range
  const steady = new LoudnessMeter(rate, 2);
  steady.push(x.subarray(0, rate * 18 * 2));
  assert.ok(steady.range()! < 0.2);
});
