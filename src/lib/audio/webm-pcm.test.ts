import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebmPcmReader, pickChannels } from './webm-pcm.ts';

// A tiny live-style WebM, shaped like Chrome's: unknown-size Segment and Cluster.
const bytes = (...parts: (number[] | Uint8Array)[]) => new Uint8Array(parts.flatMap((p) => [...p]));
const el = (id: number[], data: Uint8Array) => bytes(id, data.length < 127 ? [0x80 | data.length] : [0x40 | (data.length >> 8), data.length & 0xff], data);
const unknown = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const f64 = (v: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); return b; };
const f32le = (vals: number[]) => { const b = new Uint8Array(vals.length * 4); vals.forEach((v, i) => new DataView(b.buffer).setFloat32(i * 4, v, true)); return b; };
const block = (vals: number[]) => el([0xa3], bytes([0x81, 0, 0, 0x80], f32le(vals)));
const webm = bytes(
  el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], new TextEncoder().encode('webm'))),
  [0x18, 0x53, 0x80, 0x67], unknown,
  el([0x16, 0x54, 0xae, 0x6b], el([0xae], bytes(
    el([0x86], new TextEncoder().encode('A_PCM/FLOAT/IEEE')),
    el([0xe1], bytes(el([0xb5], f64(48000)), el([0x9f], new Uint8Array([2])), el([0x62, 0x64], new Uint8Array([32])))),
  ))),
  [0x1f, 0x43, 0xb6, 0x75], unknown,
  el([0xe7], new Uint8Array([0])),
  block([0.5, -0.25, 0.125, 0]),
  block([-1, 1]),
);

test('reads format and samples, however the bytes are split', () => {
  for (const size of [1, 7, webm.length]) {
    const r = new WebmPcmReader();
    const out: number[] = [];
    for (let o = 0; o < webm.length; o += size) for (const s of r.push(webm.subarray(o, o + size))) out.push(...s);
    assert.deepEqual(r.format, { sampleRate: 48000, channels: 2, bitDepth: 32, float: true });
    assert.deepEqual(out, [0.5, -0.25, 0.125, 0, -1, 1], `split every ${size}`);
  }
});

test('picks one input, both as stereo, or the average', () => {
  const s = new Float32Array([0.5, -0.25, 0.125, 0]);
  assert.deepEqual([...pickChannels(s, 2, 0, false)], [0.5, 0.125]);
  assert.deepEqual([...pickChannels(s, 2, 1, false)], [-0.25, 0]);
  assert.deepEqual([...pickChannels(s, 2, null, true)], [0.5, -0.25, 0.125, 0]);
  assert.deepEqual([...pickChannels(s, 2, null, false)], [0.125, 0.0625]);
  // A one-channel source doubled into two keeps its level when mixed.
  assert.deepEqual([...pickChannels(new Float32Array([0.5, 0.5]), 2, null, false)], [0.5]);
});

test('not PCM', () => {
  const r = new WebmPcmReader();
  const opus = webm.slice();
  const name = new TextEncoder().encode('A_PCM/FLOAT/IEEE');
  const i = opus.findIndex((_, o) => name.every((c, k) => opus[o + k] === c));
  opus.set(new TextEncoder().encode('A_OPUS__________'), i);
  assert.throws(() => r.push(opus), /Expected PCM/);
});
