import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, pcmBytes, tone, wavHeader } from './wav.ts';

const read = async (blob: Blob) => new DataView(await blob.arrayBuffer());
const tag = (v: DataView, o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(o + i)));

test('16-bit header and sizes', async () => {
  const v = await read(encodeWav([new Float32Array(100), new Float32Array(50)], { sampleRate: 48000, bitDepth: 16 }));
  assert.equal(tag(v, 0), 'RIFF');
  assert.equal(tag(v, 8), 'WAVE');
  assert.equal(v.getUint16(22, true), 1, 'mono');
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 300, 'data size');
  assert.equal(v.getUint32(4, true), v.byteLength - 8, 'RIFF size');
});

test('24-bit odd data is padded and RIFF size stays right', async () => {
  const v = await read(encodeWav([new Float32Array(3)], { sampleRate: 44100, bitDepth: 24 }));
  assert.equal(v.getUint32(40, true), 9);
  assert.equal(v.byteLength, 44 + 10);
  assert.equal(v.getUint32(4, true), v.byteLength - 8);
});

test('sample conversion clamps and hits full scale', () => {
  const b16 = new DataView(pcmBytes(new Float32Array([1, -1, 2, 0]), 16).buffer);
  assert.deepEqual([0, 2, 4, 6].map((o) => b16.getInt16(o, true)), [32767, -32768, 32767, 0]);
  const b24 = pcmBytes(new Float32Array([1, -1]), 24);
  assert.deepEqual([...b24], [0xff, 0xff, 0x7f, 0x00, 0x00, 0x80]);
});

test('markers write cue and labl chunks after data', async () => {
  const v = await read(
    encodeWav([new Float32Array(10)], {
      sampleRate: 48000,
      bitDepth: 16,
      markers: [{ at: 0, label: 'Take 1' }, { at: 5, label: 'Punch-in L3' }],
    }),
  );
  const cue = 44 + 20;
  assert.equal(tag(v, cue), 'cue ');
  assert.equal(v.getUint32(cue + 8, true), 2);
  assert.equal(v.getUint32(cue + 12 + 24 + 20, true), 5, 'second cue sample offset');
  const list = cue + 8 + 4 + 48;
  assert.equal(tag(v, list), 'LIST');
  assert.equal(tag(v, list + 8), 'adtl');
  assert.equal(tag(v, list + 12), 'labl');
  assert.equal(v.getUint32(4, true), v.byteLength - 8);
});

test('tone is 1 kHz at -20 dBFS', () => {
  const t = tone(48000);
  assert.equal(t.length, 24000);
  const peak = Math.max(...t);
  assert.ok(Math.abs(peak - 0.1) < 0.001, `peak ${peak}`);
});

test('stereo header counts frames and doubles the block', () => {
  const h = new DataView(wavHeader(100, { sampleRate: 48000, bitDepth: 24, channels: 2 }).buffer);
  assert.equal(h.getUint16(22, true), 2);
  assert.equal(h.getUint16(32, true), 6);
  assert.equal(h.getUint32(28, true), 48000 * 6);
  assert.equal(h.getUint32(40, true), 600);
});

test('stereo WAV from interleaved samples', () => {
  const blob = encodeWav([new Float32Array([0.5, -0.5, 0.25, -0.25])], { sampleRate: 44100, bitDepth: 16, channels: 2 });
  assert.equal(blob.size, 44 + 8);
});

test('stereo tone has the same sample on both sides', () => {
  const t = tone(48000, { channels: 2 });
  assert.equal(t.length, 48000);
  for (let i = 0; i < t.length; i += 2) assert.equal(t[i], t[i + 1]);
});
