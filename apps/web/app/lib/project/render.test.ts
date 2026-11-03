import { describe, expect, it } from "vitest";
import { addTrack, createProject, cutRange, cutRanges, setClipLevels, splitAt, trimClip, updateTrack, withCrossfades, type ProjectDoc } from "./document";
import { clipGainAt } from "./plan";
import { renderWav, type RenderSummary } from "@podstudio/audio/render";
import { Resampler } from "@podstudio/audio/resample";
import { LoudnessMeter, PODCAST_LOUDNESS, TruePeakMeter } from "@podstudio/audio/loudness";

const R = 48_000;
const must = (r: any): ProjectDoc => {
  if (!r.ok) throw new Error(r.error);
  return r.doc;
};
/** Deterministic test sources: distinct tones + a little seeded noise so misplacement can't hide. */
function makeSource(id: string, seconds: number, freq: number) {
  let seed = id.length * 7919;
  const x = new Float32Array(seconds * R);
  for (let i = 0; i < x.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    x[i] = 0.4 * Math.sin((2 * Math.PI * freq * i) / R) + 0.05 * ((seed / 2 ** 32) * 2 - 1);
  }
  return x;
}
/** Quiet bed with loud spikes: a high crest factor, so normalising up has to use the limiter. */
function spiky(seconds: number) {
  const x = makeSource("spiky", seconds, 180);
  for (let i = 0; i < x.length; i++) x[i] = x[i]! * 0.08;
  for (let s = 0.5; s < seconds; s += 1.3) for (let i = 0; i < 240; i++) x[Math.round(s * R) + i] += 0.85 * Math.sin((2 * Math.PI * 3000 * i) / R) * (1 - i / 240);
  return x;
}
const SRC: Record<string, Float32Array> = { s1: makeSource("s1", 30, 220), s2: makeSource("s2", 30, 330), s3: spiky(30) };
const read = async (id: string, from: number, count: number) => [SRC[id]!.slice(from, from + count)];

async function render(doc: ProjectDoc, bitDepth: 16 | 24, sampleRate: 44100 | 48000, extra: { channels?: 1 | 2; loudness?: { targetLufs: number; truePeakDb: number } } = {}) {
  const chunks: Uint8Array[] = [];
  const it = renderWav({ doc, bitDepth, sampleRate, read, ...extra });
  let summary: RenderSummary;
  for (;;) {
    const n = await it.next();
    if (n.done) {
      summary = n.value;
      break;
    }
    chunks.push(n.value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    bytes.set(c, o);
    o += c.length;
  }
  return { bytes, summary };
}
const decode = (bytes: Uint8Array, bitDepth: 16 | 24) => {
  const per = bitDepth / 8;
  const n = (bytes.length - 44) / per;
  const out = new Float32Array(n);
  for (let i = 0, o = 44; i < n; i++, o += per) {
    let v = bitDepth === 16 ? bytes[o]! | (bytes[o + 1]! << 8) : bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16);
    v = bitDepth === 16 ? (v << 16) >> 16 : (v << 8) >> 8;
    out[i] = v / (bitDepth === 16 ? 32768 : 8388608);
  }
  return out;
};
const rmsDb = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i]! - b[i]!) ** 2;
  return 10 * Math.log10(s / a.length + 1e-20);
};

/** The definition, evaluated one sample at a time with no windows or blocks: what the edit *means*. */
function reference(doc: ProjectDoc): Float32Array {
  const anySolo = doc.tracks.some((t) => t.solo);
  const audible = new Set(doc.tracks.filter((t) => (anySolo ? t.solo : !t.muted)).map((t) => t.id));
  let len = 0;
  for (const c of doc.clips) len = Math.max(len, c.start + c.length);
  const out = new Float32Array(len);
  for (const c of doc.clips) {
    if (!audible.has(c.trackId)) continue;
    const tr = doc.tracks.find((x) => x.id === c.trackId);
    const tg = tr?.gainDb ? Math.pow(10, tr.gainDb / 20) : 1;
    for (let t = c.start; t < c.start + c.length; t++) out[t] += SRC[c.sourceId]![c.srcStart + (t - c.start)]! * clipGainAt(c, t) * tg;
  }
  return out;
}

const twoTrackDoc = () => {
  let d = createProject({ sampleRate: R, source: { id: "s1", assetId: "a", label: "host", totalSamples: 30 * R } });
  d = { ...addTrack({ ...d, sources: [...d.sources, { id: "s2", assetId: "b", label: "guest", totalSamples: 30 * R }] }, "guest") };
  const gid = d.tracks[1]!.id;
  d = { ...d, clips: [...d.clips, { id: "g", trackId: gid, sourceId: "s2", srcStart: 0, length: 30 * R, start: 0, gainDb: -3, fadeIn: 0, fadeOut: 0 }] };
  return d;
};

describe("renderWav parity with the edit definition", () => {
  it("matches sample-for-sample after linked ripple cuts, gain and fades (24-bit 48 kHz): residual far below −60 dBFS", async () => {
    let d = twoTrackDoc();
    d = must(cutRanges(d, [{ from: 5 * R + 123, to: 7 * R + 77 }, { from: 14 * R, to: 15.5 * R }, { from: 22 * R, to: 22 * R + 1 }], { ripple: true }));
    d = must(setClipLevels(d, d.clips.find((c) => c.trackId === d.tracks[0]!.id)!.id, { gainDb: -6, fadeIn: 2 * R, fadeOut: 1000 }));
    const { bytes, summary } = await render(d, 24, 48000);
    const got = decode(bytes, 24);
    const want = reference(d);
    expect(got.length).toBe(want.length);
    expect(summary.frames).toBe(want.length);
    expect(rmsDb(got, want)).toBeLessThan(-100); // only 24-bit quantisation remains
  });
  it("is byte-identical on every run, and honours mute and solo", async () => {
    let d = twoTrackDoc();
    const a = await render(d, 24, 48000);
    const b = await render(d, 24, 48000);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    d = must(updateTrack(d, d.tracks[1]!.id, { muted: true }));
    const muted = decode((await render(d, 24, 48000)).bytes, 24);
    expect(rmsDb(muted, reference(d))).toBeLessThan(-100);
    d = must(updateTrack(d, d.tracks[1]!.id, { muted: false, solo: true }));
    expect(rmsDb(decode((await render(d, 24, 48000)).bytes, 24), reference(d))).toBeLessThan(-100);
  });
  it("writes a correct WAV header and the exact length for 16-bit with dither (residual < −60 dBFS, deterministic)", async () => {
    const d = must(cutRange(twoTrackDoc(), 3 * R, 4 * R, { ripple: true }));
    const { bytes } = await render(d, 16, 48000);
    const v = new DataView(bytes.buffer, bytes.byteOffset);
    expect([v.getUint32(24, true), v.getUint16(22, true), v.getUint16(34, true)]).toEqual([48000, 1, 16]);
    expect(v.getUint32(40, true)).toBe(bytes.length - 44);
    expect(v.getUint32(4, true)).toBe(bytes.length - 8);
    expect(rmsDb(decode(bytes, 16), reference(d))).toBeLessThan(-80); // dither noise sits near −96 dBFS
    const again = await render(d, 16, 48000);
    expect(Buffer.from(again.bytes).equals(Buffer.from(bytes))).toBe(true);
  });
  it("reports peak and clipped samples when the mix is too hot", async () => {
    let d = twoTrackDoc();
    d = must(setClipLevels(d, d.clips[0]!.id, { gainDb: 12 }));
    const { summary } = await render(d, 24, 48000);
    expect(summary.peak).toBeGreaterThan(1);
    expect(summary.clipped).toBeGreaterThan(0);
  });
});

describe("44.1 kHz conversion", () => {
  it("gives the right length and a clean 1 kHz tone (residual < −70 dBFS against an ideal tone)", async () => {
    const x = Float32Array.from({ length: 10 * R }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / R));
    const rs = new Resampler(R, 44100);
    const parts: Float32Array[] = [];
    for (let i = 0; i < x.length; i += 48000) parts.push(rs.push(x.subarray(i, i + 48000)));
    parts.push(rs.finish(x.length));
    const y = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      y.set(p, o);
      o += p.length;
    }
    expect(y.length).toBe(441_000);
    // compare away from the very edges (the first/last ~25 input samples see the zero padding)
    const ideal = Float32Array.from({ length: y.length }, (_, n) => 0.5 * Math.sin((2 * Math.PI * 1000 * n) / 44100));
    expect(rmsDb(y.subarray(100, y.length - 100), ideal.subarray(100, y.length - 100))).toBeLessThan(-70);
  });
  it("keeps the audible band flat (1, 10, 20 kHz within 0.1 dB) and rejects what would fold back into it (23.5 kHz < −60 dB, 22.5 kHz < −40 dB)", () => {
    const gainDb = (f: number) => {
      const x = Float32Array.from({ length: 2 * R }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / R));
      const y = new Resampler(R, 44100).push(x);
      let s = 0;
      for (let i = 3000; i < y.length - 3000; i++) s += y[i]! ** 2;
      return 10 * Math.log10(s / (y.length - 6000) / 0.125);
    };
    for (const f of [1000, 10000, 20000]) expect(Math.abs(gainDb(f))).toBeLessThan(0.1);
    expect(gainDb(23500)).toBeLessThan(-60);
    expect(gainDb(22500)).toBeLessThan(-40);
  });
  it("renders a full project at 44.1 kHz with the right frame count and header", async () => {
    const d = must(cutRange(twoTrackDoc(), 3 * R, 4 * R, { ripple: true }));
    const { bytes, summary } = await render(d, 24, 44100);
    const v = new DataView(bytes.buffer, bytes.byteOffset);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(summary.frames).toBe(Math.ceil((29 * R * 147) / 160));
    expect((bytes.length - 44) / 3).toBe(summary.frames);
  });
});

describe("crossfades in the render", () => {
  it("a clip trimmed back over its neighbour from the same take crossfades seamlessly: the overlap equals the original", async () => {
    let d = createProject({ sampleRate: R, source: { id: "s1", assetId: "a", label: "host", totalSamples: 30 * R } });
    d = must(splitAt(d, 10 * R));
    const later = d.clips.find((c) => c.start === 10 * R)!;
    d = must(trimClip(d, later.id, "start", 9 * R)); // 1 s crossfade, both clips read the same source samples there
    const got = decode((await render(d, 24, 48000)).bytes, 24);
    const original = SRC.s1!.slice(0, got.length);
    expect(rmsDb(got.subarray(9 * R, 10 * R), original.subarray(9 * R, 10 * R))).toBeLessThan(-100);
    expect(rmsDb(got, original)).toBeLessThan(-100);
  });
  it("matches the definition when two different sources crossfade", async () => {
    let d = twoTrackDoc();
    const host = d.tracks[0]!.id;
    d = must(cutRange(d, 0, 30 * R, { ripple: false, trackIds: [d.tracks[1]!.id] }));
    d = { ...d, clips: [...d.clips.filter((c) => c.trackId === host).map((c) => ({ ...c, length: 12 * R })), { id: "x", trackId: host, sourceId: "s2", srcStart: 0, length: 10 * R, start: 10 * R, gainDb: 0, fadeIn: 0, fadeOut: 0 }] };
    const xf = withCrossfades(d);
    const want = reference({ ...d, clips: d.clips.map((c) => xf.get(c.id)!) });
    const got = decode((await render(d, 24, 48000)).bytes, 24);
    expect(got.length).toBe(want.length);
    expect(rmsDb(got, want)).toBeLessThan(-100);
  });
});

describe("loudness normalisation (the podcast delivery step)", () => {
  const measure = (pcm: Float32Array, channels: 1 | 2, rate: number) => {
    const chs = channels === 1 ? [pcm] : [pcm.filter((_, i) => i % 2 === 0), pcm.filter((_, i) => i % 2 === 1)];
    const m = new LoudnessMeter(rate, channels);
    m.push(chs);
    const tp = new TruePeakMeter(channels);
    tp.push(chs);
    return { lufs: m.integrated(), tp: tp.db(), chs };
  };
  const target = (ch: 1 | 2) => ({ targetLufs: ch === 1 ? PODCAST_LOUDNESS.mono : PODCAST_LOUDNESS.stereo, truePeakDb: PODCAST_LOUDNESS.truePeakDb });

  it("mono export lands on −19 LUFS with peaks under −1 dBTP, and the summary says so", async () => {
    const d = twoTrackDoc();
    const { bytes, summary } = await render(d, 24, 48000, { loudness: target(1) });
    const got = measure(decode(bytes, 24), 1, 48000);
    expect(Math.abs(got.lufs - -19)).toBeLessThan(0.3);
    expect(got.tp).toBeLessThanOrEqual(-1);
    expect(Math.abs(summary.integratedLufs! - got.lufs)).toBeLessThan(0.05);
    expect(summary.normalise!.targetLufs).toBe(-19);
  });

  it("stereo export is the mono mix on both channels, at −16 LUFS (the same perceived level)", async () => {
    const d = twoTrackDoc();
    const { bytes, summary } = await render(d, 24, 44100, { channels: 2, loudness: target(2) });
    expect(bytes[22]).toBe(2); // WAV header: 2 channels
    const got = measure(decode(bytes, 24), 2, 44100);
    expect(got.chs[0]!.every((v, i) => v === got.chs[1]![i])).toBe(true);
    expect(Math.abs(got.lufs - -16)).toBeLessThan(0.3);
    expect(got.tp).toBeLessThanOrEqual(-1);
    expect(summary.frames).toBe(got.chs[0]!.length);
  });

  it("a peaky mix that needs a big boost is limited to the ceiling and still reaches the target", async () => {
    let d = createProject({ sampleRate: R, source: { id: "s3", assetId: "c", label: "peaky", totalSamples: 30 * R } });
    const { bytes, summary } = await render(d, 16, 48000, { loudness: target(1) });
    const got = measure(decode(bytes, 16), 1, 48000);
    expect(summary.normalise!.gainDb).toBeGreaterThan(6);
    expect(summary.normalise!.reached).toBe(true);
    expect(summary.normalise!.limitedSamples).toBeGreaterThan(0);
    expect(Math.abs(got.lufs - -19)).toBeLessThan(0.5);
    expect(got.tp).toBeLessThanOrEqual(-1);
    expect(summary.clipped).toBe(0);
    void d;
  });

  it("silence isn't boosted", async () => {
    const d = { ...createProject({ sampleRate: R, source: { id: "s1", assetId: "a", label: "host", totalSamples: 30 * R } }) };
    d.clips = d.clips.map((c) => ({ ...c, gainDb: -60 }));
    const { summary } = await render(d, 24, 48000, { loudness: target(1) });
    expect(summary.normalise!.gainDb).toBeLessThanOrEqual(30);
  });
});

it("says so when a target can't be reached (a near-silent mix is boosted at most 30 dB)", async () => {
  const d0 = createProject({ sampleRate: R, source: { id: "s1", assetId: "a", label: "host", totalSamples: 30 * R } });
  const d = { ...d0, clips: d0.clips.map((c) => ({ ...c, gainDb: -50 })) };
  const { summary } = await render(d, 24, 48000, { loudness: { targetLufs: -19, truePeakDb: -1 } });
  expect(summary.normalise!.capped).toBe(true);
  expect(summary.normalise!.gainDb).toBe(30);
  expect(summary.normalise!.reached).toBe(false);
});

describe("track volume (fader)", () => {
  it("scales the whole track in the export, on top of clip gain and fades", async () => {
    let d = twoTrackDoc();
    d = must(setClipLevels(d, d.clips.find((c) => c.trackId === d.tracks[0]!.id)!.id, { gainDb: -3, fadeIn: R }));
    d = must(updateTrack(d, d.tracks[0]!.id, { gainDb: -9.5 }));
    d = must(updateTrack(d, d.tracks[1]!.id, { gainDb: 4 }));
    const got = decode((await render(d, 24, 48000)).bytes, 24);
    expect(rmsDb(got, reference(d))).toBeLessThan(-100);
    // and it really changed the mix
    const flat = must(updateTrack(must(updateTrack(d, d.tracks[0]!.id, { gainDb: 0 })), d.tracks[1]!.id, { gainDb: 0 }));
    expect(rmsDb(got, reference(flat))).toBeGreaterThan(-40);
  });
});

describe("stereo", () => {
  // a stereo source whose channels differ (220 Hz left, 330 Hz right), interleaving done by the reader
  const SL = makeSource("stL", 10, 220);
  const SR = makeSource("stRight", 10, 330);
  const readSt = async (id: string, from: number, count: number) => (id === "st" ? [SL.slice(from, from + count), SR.slice(from, from + count)] : [SRC[id]!.slice(from, from + count)]);
  async function renderSt(doc: ProjectDoc, channels: 1 | 2) {
    const chunks: Uint8Array[] = [];
    const it = renderWav({ doc, bitDepth: 24, sampleRate: 48000, read: readSt, channels });
    for (;;) {
      const n = await it.next();
      if (n.done) break;
      chunks.push(n.value);
    }
    const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const pcm = decode(new Uint8Array(bytes), 24);
    return channels === 1 ? [pcm] : [pcm.filter((_, i) => i % 2 === 0), pcm.filter((_, i) => i % 2 === 1)];
  }
  /** Independent definition: per clip, source channel (mono feeds both) × clip gain × fader × balance pan, summed. */
  function refSt(doc: ProjectDoc): [Float32Array, Float32Array] {
    let len = 0;
    for (const c of doc.clips) len = Math.max(len, c.start + c.length);
    const L = new Float32Array(len);
    const R = new Float32Array(len);
    for (const c of doc.clips) {
      const src = doc.sources.find((s) => s.id === c.sourceId)!;
      const tr = doc.tracks.find((t) => t.id === c.trackId)!;
      const g = tr.gainDb ? Math.pow(10, tr.gainDb / 20) : 1;
      const p = tr.pan ?? 0;
      const pl = Math.min(1, 1 - p);
      const pr = Math.min(1, 1 + p);
      for (let t = c.start; t < c.start + c.length; t++) {
        const k = c.srcStart + (t - c.start);
        const l = src.channels === 2 ? SL[k]! : SRC[src.id]![k]!;
        const r = src.channels === 2 ? SR[k]! : SRC[src.id]![k]!;
        const cg = clipGainAt(c, t) * g;
        L[t] += l * cg * pl;
        R[t] += r * cg * pr;
      }
    }
    return [L, R];
  }
  const stereoDoc = () => {
    let d = createProject({ sampleRate: R, source: { id: "s1", assetId: "a", label: "host", totalSamples: 30 * R } });
    d = { ...d, clips: d.clips.map((c) => ({ ...c, length: 8 * R })) };
    d = addTrack(d, "music");
    const music = d.tracks[1]!.id;
    d = { ...d, sources: [...d.sources, { id: "st", assetId: "b", label: "bed", totalSamples: 10 * R, channels: 2 }], clips: [...d.clips, { id: "m", trackId: music, sourceId: "st", srcStart: 0, length: 6 * R, start: R, gainDb: -6, fadeIn: R / 2, fadeOut: R }] };
    d = must(updateTrack(d, music, { pan: -0.4, gainDb: -3 }));
    d = must(updateTrack(d, d.tracks[0]!.id, { pan: 0.25 }));
    return d;
  };

  it("stereo export matches the definition on both channels (stereo source, mono source, both panned)", async () => {
    const d = stereoDoc();
    const [gl, gr] = await renderSt(d, 2);
    const [wl, wr] = refSt(d);
    expect(gl!.length).toBe(wl.length);
    expect(rmsDb(gl!, wl)).toBeLessThan(-100);
    expect(rmsDb(gr!, wr)).toBeLessThan(-100);
    expect(rmsDb(gl!, gr!)).toBeGreaterThan(-40); // the channels really differ
  });

  it("mono export of the same project is exactly (L + R) / 2", async () => {
    const d = stereoDoc();
    const [m] = await renderSt(d, 1);
    const [wl, wr] = refSt(d);
    const want = wl.map((v, i) => (v + wr[i]!) / 2);
    expect(rmsDb(m!, want)).toBeLessThan(-100);
  });

  it("a centred mono project renders exactly as before: mono export = the source mix, stereo export = the same on both sides", async () => {
    const d = twoTrackDoc();
    const [m] = await renderSt(d, 1);
    expect(rmsDb(m!, reference(d))).toBeLessThan(-100);
    const [l, r] = await renderSt(d, 2);
    expect(rmsDb(l!, reference(d))).toBeLessThan(-100);
    expect(rmsDb(r!, reference(d))).toBeLessThan(-100);
  });

  it("stereo loudness normalisation is measured on the real two channels (−16 LUFS)", async () => {
    const d = stereoDoc();
    const chunks: Uint8Array[] = [];
    const it = renderWav({ doc: d, bitDepth: 24, sampleRate: 48000, read: readSt, channels: 2, loudness: { targetLufs: -16, truePeakDb: -1 } });
    let summary: RenderSummary | undefined;
    for (;;) {
      const n = await it.next();
      if (n.done) {
        summary = n.value;
        break;
      }
      chunks.push(n.value);
    }
    const pcm = decode(new Uint8Array(Buffer.concat(chunks.map((c) => Buffer.from(c)))), 24);
    const m = new LoudnessMeter(48000, 2);
    m.push([pcm.filter((_, i) => i % 2 === 0), pcm.filter((_, i) => i % 2 === 1)]);
    expect(Math.abs(m.integrated() + 16)).toBeLessThan(0.3);
    expect(summary!.normalise!.reached).toBe(true);
  });
});

describe("track FX in the render", () => {
  it("FX run per track after ducking and before the fader; latency is removed; matches FxChain applied to each track", async () => {
    const { FxChain, FX_LATENCY, defaultFx } = await import("@podstudio/audio/fx");
    let d = twoTrackDoc();
    const host = d.tracks[0]!.id;
    const fx = defaultFx();
    fx.nr.on = true;
    fx.nr.amount = 0.7;
    fx.hpf.on = true;
    fx.hpf.freq = 150;
    fx.eq.mid = { gainDb: 5, freq: 1800 };
    fx.comp.on = true;
    fx.comp.amount = 0.5;
    d = must(updateTrack(d, host, { fx, gainDb: -2 }));
    const got = decode((await render(d, 24, 48000)).bytes, 24);
    // reference: each track's pre-fader signal through its own chain (the guest's chain is neutral = delay), then fader, summed
    const perTrack = (trackId: string) => reference({ ...d, tracks: d.tracks.map((t) => ({ ...t, gainDb: 0, fx: undefined, solo: t.id === trackId })) });
    const len = got.length;
    const want = new Float32Array(len);
    for (const t of d.tracks) {
      const x = perTrack(t.id);
      const chain = new FxChain(48000, 1, t.fx);
      const padded = new Float32Array(len + FX_LATENCY);
      padded.set(x);
      const y = chain.process([padded])[0]!.subarray(FX_LATENCY, FX_LATENCY + len);
      const g = t.gainDb ? Math.pow(10, t.gainDb / 20) : 1;
      for (let i = 0; i < len; i++) want[i] += y[i]! * g;
    }
    expect(got.length).toBe(projectLengthOf(d));
    expect(rmsDb(got, want)).toBeLessThan(-100);
    // and the FX really changed the sound
    expect(rmsDb(got, reference({ ...d, tracks: d.tracks.map((t) => ({ ...t, fx: undefined })) }))).toBeGreaterThan(-40);
  });

  it("a project with no active FX renders byte-for-byte as before", async () => {
    const d = twoTrackDoc();
    const { defaultFx } = await import("@podstudio/audio/fx");
    const neutral = must(updateTrack(d, d.tracks[0]!.id, { fx: defaultFx() }));
    const a = await render(d, 24, 48000);
    const b = await render(neutral, 24, 48000);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });
});

function projectLengthOf(d: ProjectDoc) {
  return Math.max(...d.clips.map((c) => c.start + c.length));
}
