import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaSource } from './media-source.ts';
import { wavHeader } from './wav.ts';
test('four-minute imported audio reads bounded frames with cached Blob and independent cursors', async () => {
  const bytes: number[] = []; let loads = 0;
  class ObservedBlob extends Blob { override slice(start?: number, end?: number, type?: string) { bytes.push((end ?? this.size) - (start ?? 0)); return super.slice(start, end, type); } }
  const wav = new ObservedBlob([wavHeader(48000 * 240, { channels: 2, sampleRate: 48000, bitDepth: 16 }), new Uint8Array(48000 * 240 * 4)]);
  const source = mediaSource(async () => { loads++; return wav; });
  const [first, second] = await Promise.all([source.read(0, 30), source.read(30, 30)]);
  assert.equal(first.length, 48000 * 30 * 2); assert.equal(second.length, first.length);
  assert.equal(loads, 1); assert.ok(Math.max(...bytes) <= 48000 * 30 * 4);
  assert.ok(bytes.reduce((a, b) => a + b, 0) < wav.size / 3);
});
