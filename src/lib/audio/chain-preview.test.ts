import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChainPreview, type ChainSettings } from './chain-preview.ts';
import { encodeWav } from './wav.ts';
import { flatTone } from './tone.ts';

const rate = 48000;
const secs = 3;
const n = rate * secs;
// A "voice" at 440 Hz and a 60 Hz hum under it; the stand-in denoiser takes the hum out exactly.
const hum = Float32Array.from({ length: n }, (_, i) => 0.05 * Math.sin((2 * Math.PI * 60 * i) / rate));
const voice = Float32Array.from({ length: n }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / rate) * (Math.floor(i / (rate / 4)) % 2));
const take = voice.map((v, i) => v + hum[i]);
const wav = (x: Float32Array) => encodeWav([x], { sampleRate: rate, bitDepth: 24, channels: 1 });

/** Level of one frequency in a mix (Goertzel), in dB, over its first channel. */
function at(f: number, x: Float32Array, channels: number) {
  const w = (2 * Math.PI * f) / rate;
  let s1 = 0, s2 = 0, count = 0;
  for (let i = 0; i < x.length; i += channels) {
    const s = x[i] + 2 * Math.cos(w) * s1 - s2;
    s2 = s1;
    s1 = s;
    count++;
  }
  return 20 * Math.log10(Math.sqrt(s1 * s1 + s2 * s2 - 2 * Math.cos(w) * s1 * s2) / count);
}

function chain() {
  const calls: number[] = [];
  const denoise = async (x: Float32Array, _ch: number, _rate: number, amount: number) => {
    calls.push(amount);
    return x.map((v, i) => v - hum[i]);
  };
  const c = new ChainPreview(async () => [{ key: 'HOST', raw: wav(take), edit: wav(take) }], rate, denoise);
  return { c, calls };
}
const settings = (o: Partial<ChainSettings> = {}): ChainSettings => ({ ns: 40, tones: { HOST: flatTone() }, loudness: 'stereo', level: false, ...o });

test('noise: cleaned has no hum, and Removed is only the hum', async () => {
  const { c } = chain();
  const r = await c.stage('noise', settings());
  const [orig, clean, removed] = r.audio.options;
  assert.equal(r.audio.channels, 2);
  assert.ok(at(60, orig, 2) - at(60, clean, 2) > 40, `${at(60, orig, 2)} vs ${at(60, clean, 2)}`);
  assert.ok(at(440, removed, 2) < at(60, removed, 2) - 40, 'no voice in Removed');
  assert.ok(Math.abs(at(60, removed, 2) - at(60, orig, 2)) < 1, 'the hum at its own level');
  assert.ok(r.reduction! > 20, String(r.reduction));
});

test('tone and loudness hear the cleaned audio (the noise stage comes first)', async () => {
  const { c, calls } = chain();
  const tone = await c.stage('tone', settings());
  const loud = await c.stage('loud', settings({ level: true }));
  for (const [name, x] of [['tone before', tone.audio.options[0]], ['with tone', tone.audio.options[1]], ['loudness before', loud.audio.options[0]], ['levelled', loud.audio.options[1]]] as const)
    assert.ok(at(60, x, 2) < at(440, x, 2) - 40, `${name}: hum ${at(60, x, 2).toFixed(1)}, voice ${at(440, x, 2).toFixed(1)}`);
  assert.deepEqual(calls, [40], 'cleaned once, then kept');
  // With noise off, the hum is back
  const off = await c.stage('tone', settings({ ns: 0 }));
  assert.ok(at(60, off.audio.options[1], 2) > at(440, off.audio.options[1], 2) - 20);
});

test('loudness: levelled reaches the target; mono makes one channel', async () => {
  const { c } = chain();
  const r = await c.stage('loud', settings({ loudness: 'mono' }));
  assert.equal(r.audio.channels, 1);
  assert.ok(Math.abs(r.loud!.after.meter!.integrated + 19) < 0.5, String(r.loud!.after.meter!.integrated));
  assert.ok(r.loud!.before.meter!.integrated < -19);
});
