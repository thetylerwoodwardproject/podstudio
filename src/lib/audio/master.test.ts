import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from './wav.ts';
import { renderMaster, Resampler } from './master.ts';
import { LoudnessMeter } from './loudness.ts';

/** Speech-like test signal: noise bursts (syllables) with pauses, at a given level. */
function voice(rate: number, seconds: number, dbfs: number, seed: number) {
  let s = seed;
  const a = 10 ** (dbfs / 20) * Math.sqrt(3);
  const x = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < x.length; i++) {
    const syl = Math.max(0, Math.sin((2 * Math.PI * 4 * i) / rate)) ** 0.5;
    const phrase = (i / rate) % 6 < 5 ? 1 : 0;
    x[i] = ((s = (s * 16807) % 2147483647) / 2147483647 * 2 - 1) * a * syl * phrase;
  }
  return x;
}

const collect = () => {
  const parts: Float32Array[] = [];
  return {
    write: async (x: Float32Array) => void parts.push(x.slice()),
    all: () => {
      const y = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0;
      for (const p of parts) {
        y.set(p, o);
        o += p.length;
      }
      return y;
    },
  };
};

const lufs = (x: Float32Array, rate: number, ch: number) => {
  const m = new LoudnessMeter(rate, ch);
  m.push(x);
  return m.integrated();
};

test('two voices mixed to stereo reach −16 LUFS, with nothing over −1 dBTP', async () => {
  const rate = 16000;
  const host = encodeWav([voice(rate, 40, -30, 1)], { sampleRate: rate, bitDepth: 24 });
  const guest = encodeWav([voice(rate, 40, -42, 2)], { sampleRate: rate, bitDepth: 24 });
  const out = collect();
  const r = await renderMaster([{ wav: host, level: true }, { wav: guest, level: true }], { rate, channels: 2, lufs: -16, levelling: false }, out.write);
  const y = out.all();
  assert.equal(y.length, rate * 40 * 2, 'same length as the lead track, stereo');
  assert.ok(Math.abs(lufs(y, rate, 2) + 16) < 0.5, `came out at ${lufs(y, rate, 2).toFixed(2)} LUFS`);
  assert.ok(Math.abs(r.result + 16) < 0.5);
  let peak = 0;
  for (const v of y) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak <= 10 ** (-1 / 20) + 1e-6, `sample peak ${(20 * Math.log10(peak)).toFixed(2)} dBFS`);
});

test('mono reaches −19 LUFS', async () => {
  const rate = 16000;
  const host = encodeWav([voice(rate, 30, -25, 3)], { sampleRate: rate, bitDepth: 16 });
  const out = collect();
  await renderMaster([{ wav: host, level: true }], { rate, channels: 1, lufs: -19, levelling: false }, out.write);
  assert.ok(Math.abs(lufs(out.all(), rate, 1) + 19) < 0.5, String(lufs(out.all(), rate, 1)));
});

async function levelPair(hostDb: number, guestDb: number) {
  const rate = 16000;
  const host = voice(rate, 40, hostDb, 4);
  const guest = voice(rate, 40, guestDb, 5);
  const copies: Float32Array[][] = [[], []];
  await renderMaster(
    [
      { wav: encodeWav([host], { sampleRate: rate, bitDepth: 24 }), level: true, levelled: async (x) => void copies[0].push(x.slice()) },
      { wav: encodeWav([guest], { sampleRate: rate, bitDepth: 24 }), level: true, levelled: async (x) => void copies[1].push(x.slice()) },
    ],
    { rate, channels: 1, lufs: null, levelling: true },
    collect().write,
  );
  const joined = copies.map((c) => {
    const y = new Float32Array(c.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of c) {
      y.set(p, o);
      o += p.length;
    }
    return y;
  });
  const late = (x: Float32Array) => lufs(x.subarray(rate * 20), rate, 1);
  return { host, guest, joined, before: late(host) - late(guest), after: late(joined[0]) - late(joined[1]) };
}

test('levelling brings a quiet guest up to the host, and writes levelled copies the same length', async () => {
  const r = await levelPair(-20, -32);
  assert.equal(r.joined[0].length, r.host.length);
  assert.equal(r.joined[1].length, r.guest.length);
  assert.ok(r.before > 10 && Math.abs(r.after) < 4, `gap between them: ${r.before.toFixed(1)} dB before, ${r.after.toFixed(1)} dB after`);
});

test('a very quiet guest is brought at least 10 dB closer (the boost stops at +12 dB)', async () => {
  const r = await levelPair(-20, -38);
  assert.ok(r.before - r.after >= 10, `gap: ${r.before.toFixed(1)} dB before, ${r.after.toFixed(1)} dB after`);
});

test('resampling 44.1 kHz to 48 kHz keeps the length and the tone', () => {
  const from = 44100;
  const x = Float32Array.from({ length: from * 2 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / from) * 0.5);
  const r = new Resampler(from, 48000, 1);
  const parts = [x.subarray(0, 12345), x.subarray(12345, 60000), x.subarray(60000)].map((p) => r.process(p));
  const n = parts.reduce((a, p) => a + p.length, 0);
  assert.ok(Math.abs(n - 96000) <= 2, `${n} frames`);
  const y = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    y.set(p, o);
    o += p.length;
  }
  // Compare with the ideal 1 kHz tone at 48 kHz.
  let err = 0;
  for (let i = 1000; i < n - 1000; i++) err = Math.max(err, Math.abs(y[i] - Math.sin((2 * Math.PI * 1000 * (i * (from / 48000))) / from) * 0.5));
  assert.ok(err < 0.01, `max error ${err}`);
});
