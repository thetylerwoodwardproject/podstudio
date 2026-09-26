import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpectrumAverage, curveOf, fft, longTermSpectrum } from './spectrum.ts';
import { encodeWav } from './wav.ts';

test('fft: a sine lands in its bin', () => {
  const n = 1024;
  const re = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 37 * i) / n));
  const im = new Float64Array(n);
  fft(re, im);
  const mag = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]));
  assert.equal(mag.indexOf(Math.max(...mag)), 37);
  assert.ok(Math.abs(mag[37] - n / 2) < 1e-6);
});

test('long-term spectrum: a voice with more low end reads higher there, and pauses are left out', async () => {
  const rate = 48000;
  let s = 7;
  const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  // White noise with a boost around 200 Hz (a one-pole resonator), talking half the time
  const x = new Float32Array(rate * 6);
  let y1 = 0, y2 = 0;
  const w = (2 * Math.PI * 200) / rate, rr = 0.995;
  for (let i = 0; i < x.length; i++) {
    const n = noise() * 0.05;
    const y = n + 2 * rr * Math.cos(w) * y1 - rr * rr * y2;
    y2 = y1;
    y1 = y;
    const talking = Math.floor(i / rate) % 2 === 0;
    x[i] = talking ? n + y * 0.02 : 0;
  }
  const pts = await longTermSpectrum(encodeWav([x], { sampleRate: rate, bitDepth: 24 }), 100);
  const at = curveOf(pts);
  assert.ok(at(200) - at(2000) > 6, `200 Hz ${at(200).toFixed(1)} vs 2 kHz ${at(2000).toFixed(1)}`);
  // Relative: the speech range averages 0 dB
  const speech = pts.filter(([f]) => f >= 150 && f <= 6000);
  assert.ok(Math.abs(speech.reduce((a, p) => a + p[1], 0) / speech.length) < 1e-9);
});

test('silence gives no spectrum', () => {
  const avg = new SpectrumAverage();
  avg.add(new Float64Array(4096));
  assert.equal(avg.count, 0);
  assert.deepEqual(avg.points(48000), []);
});
