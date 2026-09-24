import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from './wav.ts';
import { parseWav, remix, wavFloats } from './wav-read.ts';

test('reads back a WAV Podstudio wrote', async () => {
  const blob = encodeWav([new Float32Array([0.5, -0.25, 0.125, 0])], { sampleRate: 44100, bitDepth: 24, channels: 2 });
  const bytes = await blob.arrayBuffer();
  const info = parseWav(new DataView(bytes))!;
  assert.deepEqual({ ...info }, { format: 'pcm', channels: 2, sampleRate: 44100, bitDepth: 24, dataOffset: 44, dataBytes: 12 });
  const f = wavFloats(bytes.slice(44, 56), info);
  assert.ok(Math.abs(f[0] - 0.5) < 1e-6 && Math.abs(f[1] + 0.25) < 1e-6);
});

test('16-bit samples', async () => {
  const bytes = await encodeWav([new Float32Array([-1, 0.5])], { sampleRate: 48000, bitDepth: 16 }).arrayBuffer();
  const info = parseWav(new DataView(bytes))!;
  assert.deepEqual([...wavFloats(bytes.slice(info.dataOffset), info)], [-1, 16383 / 32768]);
});

test('not a WAV', () => {
  assert.equal(parseWav(new DataView(new TextEncoder().encode('ID3 this is an mp3 header').buffer)), null);
});

test('stereo to mono averages, mono to stereo copies', () => {
  assert.deepEqual([...remix(new Float32Array([1, 0, 0.5, 0.5]), 2, 1)], [0.5, 0.5]);
  assert.deepEqual([...remix(new Float32Array([0.25, 0.5]), 1, 2)], [0.25, 0.25, 0.5, 0.5]);
});
