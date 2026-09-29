import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from './wav.ts';
import { renderMaster, Resampler } from './master.ts';
import { LoudnessMeter } from './loudness.ts';
import { flatTone } from './tone.ts';

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

test('mono sums a stereo pads track at the balance heard in stereo', async () => {
  const rate = 16000;
  const n = rate * 2;
  const tone = (a: number, f: number) => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / rate));
  const voice = encodeWav([tone(0.2, 300)], { sampleRate: rate, bitDepth: 24 });
  // Pads: the same sound in both channels, and one only on the left
  const padL = tone(0.2, 1000);
  const padR = tone(0.2, 1000);
  const hard = Float32Array.from(tone(0.4, 1000));
  const rms = (x: Float32Array, ch: number, c: number) => {
    let s = 0;
    for (let i = rate / 2; i < n - rate / 2; i++) s += x[i * ch + c] ** 2;
    return Math.sqrt(s / (n - rate));
  };
  for (const [l, r] of [[padL, padR], [hard, new Float32Array(n)]] as const) {
    const lr = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) (lr[2 * i] = l[i]), (lr[2 * i + 1] = r[i]);
    const pads = encodeWav([lr], { sampleRate: rate, bitDepth: 24, channels: 2 });
    const mono = collect();
    await renderMaster([{ wav: voice, level: false }, { wav: pads, level: false }], { rate, channels: 1, lufs: null, levelling: false }, mono.write);
    const y = mono.all();
    assert.equal(y.length, n);
    // (L + R) ÷ 2: a centred sound keeps its level beside the voice, a hard-left one comes in at half.
    const padOnly = Float32Array.from(y, (v, i) => v - 0.2 * Math.sin((2 * Math.PI * 300 * i) / rate));
    assert.ok(Math.abs(rms(padOnly, 1, 0) - 0.2 / Math.SQRT2) < 0.005, `pad in mono: ${rms(padOnly, 1, 0)}`);
  }
});

test('each voice goes through its own tone; the result reports range, true peak and history', async () => {
  const rate = 16000;
  const host = voice(rate, 20, -34, 11);
  const plain = collect();
  await renderMaster([{ wav: encodeWav([host], { sampleRate: rate, bitDepth: 24 }), level: true }], { rate, channels: 1, lufs: null, levelling: false }, plain.write);
  const toned = collect();
  const tone = { ...flatTone(), comp: { on: true, threshold: -20, ratio: 3, knee: 8, makeup: 6, preset: null } };
  const r = await renderMaster([{ wav: encodeWav([host], { sampleRate: rate, bitDepth: 24 }), level: true, tone }], { rate, channels: 1, lufs: null, levelling: false }, toned.write);
  // Quiet speech under the threshold: the compressor leaves it, the make-up raises it 6 dB.
  const gain = lufs(toned.all(), rate, 1) - lufs(plain.all(), rate, 1);
  assert.ok(Math.abs(gain - 6) < 0.8, `tone added ${gain.toFixed(2)} dB`);
  assert.equal(r.history.length, 20);
  assert.ok(r.truePeak <= -1 + 0.1 && r.truePeak > -40, `true peak ${r.truePeak}`);
  assert.ok(r.range != null && r.range >= 0);
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

test('custom loudness and ceiling are honored and analysis can be cancelled', async () => {
  const wav = encodeWav([voice(48000, 6, -24, 39)], { sampleRate: 48000, channels: 1, bitDepth: 24 });
  const result = await renderMaster([{ wav, level: false }], { rate: 48000, channels: 1, lufs: -22, ceilingDb: -3, levelling: false }, async () => {});
  assert.ok(Math.abs(result.result + 22) < .7, String(result.result));
  assert.ok(result.truePeak <= -2.9, String(result.truePeak));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(renderMaster([{ wav, level: false }], { rate: 48000, channels: 1, lufs: -22, levelling: false, signal: controller.signal }, async () => {}), { name: 'AbortError' });
});
