import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameStream, Resampler, amountToDb, backgroundReduction, join, suggestAmount } from './denoise-core.ts';
import { pcmBytes, pcmFloats } from './wav.ts';

test('the fader: 0 is off, halfway allows 20 dB, the top has no limit', () => {
  assert.equal(amountToDb(0), 0);
  assert.equal(amountToDb(50), 20);
  assert.equal(amountToDb(90), 36);
  assert.equal(amountToDb(100), 100);
  assert.equal(amountToDb(-5), 0);
});

test('suggestions follow the noise floor', () => {
  assert.equal(suggestAmount(-72), 0);
  assert.equal(suggestAmount(-50), 40);
  assert.equal(suggestAmount(-38), 70);
});

// A stand-in for the model: 480-sample frames, output 1440 samples late.
function delayModel(frame = 480, delay = 1440) {
  let line = new Float32Array(delay);
  return (x: Float32Array) => {
    const all = new Float32Array(line.length + x.length);
    all.set(line);
    all.set(x, line.length);
    line = all.slice(x.length);
    return all.slice(0, frame);
  };
}

test('output lines up with the input and is exactly as long, however it is fed', () => {
  const input = Float32Array.from({ length: 10007 }, (_, i) => Math.sin(i / 7));
  for (const sizes of [[10007], [1, 479, 480, 481, 3000, 5566], Array(100).fill(100).concat([7])]) {
    const s = new FrameStream(delayModel());
    const parts: Float32Array[] = [];
    let o = 0;
    for (const n of sizes) {
      parts.push(s.push(input.subarray(o, o + n)));
      o += n;
    }
    parts.push(s.end());
    const out = join(parts);
    assert.equal(out.length, input.length, `fed ${sizes.length} ways`);
    assert.deepEqual([...out.slice(5000, 5005)], [...input.slice(5000, 5005)]);
    assert.equal(out.at(-1), input.at(-1));
  }
});

test('an impulse comes out on the same sample', () => {
  const input = new Float32Array(3000);
  input[1234] = 1;
  const s = new FrameStream(delayModel());
  const out = join([s.push(input), s.end()]);
  assert.equal(out.indexOf(1), 1234);
});

test('resampling 44.1 → 48 → 44.1 kHz keeps the length, timing and level', () => {
  const n = 44100;
  const tone = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 44100));
  const up = new Resampler(44100, 48000);
  const mid = join([up.push(tone.subarray(0, 10000)), up.push(tone.subarray(10000)), up.end()]);
  assert.equal(mid.length, 48000);
  const down = new Resampler(48000, 44100);
  const back = join([down.push(mid.subarray(0, 777)), down.push(mid.subarray(777)), down.end()]);
  assert.equal(back.length, n);
  // Away from the edges the tone comes back within 1 %.
  let err = 0;
  for (let i = 1000; i < n - 1000; i++) err = Math.max(err, Math.abs(back[i] - tone[i]));
  assert.ok(err < 0.005, `max error ${err}`);
});

test('48 kHz passes straight through', () => {
  const r = new Resampler(48000, 48000);
  const x = new Float32Array([1, 2, 3]);
  assert.equal(r.push(x), x);
  assert.equal(r.end().length, 0);
});

test('background reduction reads the quiet parts', () => {
  const rate = 1000;
  const input = Float32Array.from({ length: 2000 }, (_, i) => (i < 1000 ? 0.5 : 0.01) * Math.sin(i));
  const output = Float32Array.from(input, (v, i) => (i < 1000 ? v : v / 10));
  assert.equal(Math.round(backgroundReduction(input, output, rate)), 20);
});

test('PCM bytes round-trip exactly', () => {
  const x = Float32Array.from([0, 0.5, -0.5, 1, -1, 0.123456]);
  for (const depth of [16, 24] as const) {
    const back = pcmFloats(pcmBytes(x, depth), depth);
    assert.deepEqual([...pcmBytes(back, depth)], [...pcmBytes(x, depth)], `${depth}-bit`);
  }
});
