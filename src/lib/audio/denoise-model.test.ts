import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FrameStream, join } from './denoise-core.ts';

// The vendored DeepFilterNet3 build itself, run the way the worker runs it.
const dir = new URL('../../../public/vendor/deepfilter/', import.meta.url);
const df = await import(new URL('df.js', dir).href);
df.initSync(readFileSync(new URL('df_bg.wasm', dir)));
const model = readFileSync(new URL('DeepFilterNet3_onnx.bin', dir));

const db = (x: Float32Array) => 10 * Math.log10(x.reduce((n, v) => n + v * v, 0) / x.length);

test('steady noise comes down by the fader’s limit, and the output lines up', () => {
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const noise = Float32Array.from({ length: 48000 * 3 }, () => rand() * 0.02);
  const st = df.df_create(model, 12);
  const s = new FrameStream((f) => df.df_process_frame(st, f));
  const out = join([s.push(noise.subarray(0, 50000)), s.push(noise.subarray(50000)), s.end()]);
  assert.equal(out.length, noise.length);
  // After the first second (the model settling in), 12 dB quieter.
  const drop = db(noise.subarray(48000)) - db(out.subarray(48000));
  assert.ok(Math.abs(drop - 12) < 1.5, `down ${drop.toFixed(1)} dB`);
});
