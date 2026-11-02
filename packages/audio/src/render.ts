// The shared audio render path (Stage 04): turns a project document into WAV bytes. The browser
// preview schedules the same plan (`planPieces`, `gainBreakpoints`); this walks it block by
// block on the server. Mono mixdown of every audible track (mute/solo honoured), clip gain and
// linear fades, optional 44.1 kHz conversion, 16-bit TPDF dither (seeded, so identical every
// run) or plain 24-bit. Streaming: memory is a few windows of source audio, not the episode.
import { projectLength, triggerTrackIds, withCrossfades, type DuckRule, type ProjectDoc } from "./document";
import { duckGains, newDuckState, type DuckState } from "./duck";
import { WINDOW_SAMPLES, gainBreakpoints, planPieces } from "./plan";
import { Resampler } from "./resample";
import { LoudnessMeter, TruePeakLimiter, TruePeakMeter } from "./loudness";

export interface RenderOptions {
  doc: ProjectDoc;
  bitDepth: 16 | 24;
  sampleRate: 44100 | 48000;
  /** Read `count` source samples starting at `from` (clamped by the caller to the source length). */
  read: (sourceId: string, from: number, count: number) => Promise<Float32Array>;
  /** Called with 0..1 as output is produced. Throw (or abort) to stop. */
  onProgress?: (fraction: number) => void | Promise<void>;
  /** 1 (default) or 2: stereo is the mono mix on both channels. */
  channels?: 1 | 2;
  /** Normalise to this integrated loudness with a true-peak ceiling (the podcast delivery step). Absent = untouched mix. */
  loudness?: { targetLufs: number; truePeakDb: number };
}

/** Largest boost normalisation will apply (a near-silent mix stays quiet rather than turning hiss into programme). */
export const MAX_NORMALISE_GAIN_DB = 30;

export interface RenderSummary {
  frames: number;
  /** Highest absolute sample before clipping (1.0 = full scale). */
  peak: number;
  /** Samples that had to be clipped to full scale. */
  clipped: number;
  channels?: 1 | 2;
  /** Loudness of the delivered file (always measured). */
  integratedLufs?: number;
  truePeakDb?: number;
  lra?: number;
  /** Normalisation, when asked for: the mix before, the gain applied and how much the limiter worked. */
  normalise?: { targetLufs: number; truePeakDb: number; inputLufs: number; gainDb: number; capped: boolean; limitedSamples: number; minLimiterGainDb: number; /** The delivered file is within 0.5 LU of the target. */ reached: boolean };
}

export function wavHeaderBytes(frames: number, rate: number, bitDepth: 16 | 24, channels = 1): Uint8Array {
  const bytes = bitDepth / 8;
  const dataBytes = frames * channels * bytes;
  const h = new Uint8Array(44);
  const v = new DataView(h.buffer);
  const tag = (o: number, s: string) => [...s].forEach((c, i) => (h[o + i] = c.charCodeAt(0)));
  tag(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * bytes, true);
  v.setUint16(32, channels * bytes, true);
  v.setUint16(34, bitDepth, true);
  tag(36, "data");
  v.setUint32(40, dataBytes, true);
  return h;
}

/** Every audible track's audio for the timeline block [from, from + len): clip gain and fades applied, no ducking. */
export async function mixTrackBlocks(
  doc: ProjectDoc,
  from: number,
  len: number,
  windowOf: (sourceId: string, win: number) => Promise<Float32Array>,
  onlyTracks?: Set<string>,
): Promise<Map<string, Float32Array>> {
  const out = new Map<string, Float32Array>();
  const clips = withCrossfades(doc); // fades widened over crossfades
  const trackGain = new Map(doc.tracks.map((t) => [t.id, t.gainDb ? Math.pow(10, t.gainDb / 20) : 1]));
  for (const p of planPieces(doc, from, from + len)) {
    if (onlyTracks && !onlyTracks.has(p.trackId)) continue;
    const clip = clips.get(p.clipId)!;
    const buf = out.get(p.trackId) ?? new Float32Array(len);
    out.set(p.trackId, buf);
    const win = await windowOf(p.sourceId, Math.floor(p.srcStart / WINDOW_SAMPLES));
    const off = p.srcStart % WINDOW_SAMPLES;
    const bp = gainBreakpoints(clip, p);
    for (let s = 0; s < bp.length - 1; s++) {
      const [t0, g0] = bp[s]!;
      const [t1, g1] = bp[s + 1]!;
      const span = t1 - t0;
      const tg = trackGain.get(p.trackId) ?? 1; // the track's fader
      for (let t = t0; t < t1; t++) {
        const g = (g0 + ((g1 - g0) * (t - t0)) / span) * tg;
        const i = t - from;
        buf[i] = (buf[i] ?? 0) + (win[off + (t - p.start)] ?? 0) * g;
      }
    }
  }
  return out;
}

/** The trigger signal of a rule over a block: the loudest of its (audible) trigger tracks at each sample. */
export function triggerSignal(doc: ProjectDoc, rule: DuckRule, tracks: Map<string, Float32Array>, len: number): Float32Array {
  const sig = new Float32Array(len);
  for (const id of triggerTrackIds(doc, rule)) {
    const t = tracks.get(id);
    if (!t) continue;
    for (let i = 0; i < len; i++) {
      const a = Math.abs(t[i]!);
      if (a > sig[i]!) sig[i] = a;
    }
  }
  return sig;
}

/** Mix one block of the timeline to mono, applying every enabled ducking rule. `states` carries rule state between blocks. */
async function mixBlock(
  doc: ProjectDoc,
  from: number,
  len: number,
  windowOf: (sourceId: string, win: number) => Promise<Float32Array>,
  states: Map<string, DuckState>,
): Promise<Float32Array> {
  const tracks = await mixTrackBlocks(doc, from, len, windowOf);
  for (const rule of doc.ducking ?? []) {
    if (!rule.enabled) continue;
    let st = states.get(rule.id);
    if (!st) states.set(rule.id, (st = newDuckState()));
    // keep the follower running even when no trigger track has audio in this block
    const gains = duckGains(triggerSignal(doc, rule, tracks, len), rule, doc.sampleRate, st);
    for (const id of rule.targets) {
      const t = tracks.get(id);
      if (!t) continue;
      for (let i = 0; i < len; i++) t[i] = t[i]! * gains[i]!;
    }
  }
  const out = new Float32Array(len);
  for (const t of tracks.values()) for (let i = 0; i < len; i++) out[i] = out[i]! + t[i]!;
  return out;
}

function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** Streams the WAV: the 44-byte header first, then PCM in ~1 s blocks. Returns the summary when done. */
export async function* renderWav(opts: RenderOptions): AsyncGenerator<Uint8Array, RenderSummary, void> {
  const { doc, bitDepth } = opts;
  const channels = opts.channels ?? 1;
  const inRate = doc.sampleRate;
  const outRate = opts.sampleRate;
  const total = projectLength(doc);
  const frames = inRate === outRate ? total : new Resampler(inRate, outRate).outputLength(total);
  const BLOCK = inRate; // one second of timeline per step

  // a fresh small window cache per pass, keyed by source+window (pieces never straddle a window)
  const makeWindowOf = () => {
    const cache = new Map<string, Promise<Float32Array>>();
    return (sourceId: string, win: number) => {
      const k = `${sourceId}:${win}`;
      let p = cache.get(k);
      if (p) {
        cache.delete(k);
      } else {
        const src = doc.sources.find((s) => s.id === sourceId)!;
        const from = win * WINDOW_SAMPLES;
        p = opts.read(sourceId, from, Math.min(WINDOW_SAMPLES, src.totalSamples - from));
      }
      cache.set(k, p);
      while (cache.size > 6) cache.delete(cache.keys().next().value!);
      return p;
    };
  };
  /** The mono mix, one block at a time (ducking included). */
  async function* mixPass(): AsyncGenerator<Float32Array> {
    const windowOf = makeWindowOf();
    const duckStates = new Map<string, DuckState>();
    for (let t = 0; t < total; t += BLOCK) yield await mixBlock(doc, t, Math.min(BLOCK, total - t), windowOf, duckStates);
  }

  // ---- normalisation: measure, decide the gain, and correct for what the limiter takes off ----
  const norm = opts.loudness;
  const stereoOffset = channels === 2 ? 10 * Math.log10(2) : 0; // dual-mono reads +3.01 LU over the mono mix
  let passes = 1;
  let passDone = 0;
  const progress = async (inPass: number) => opts.onProgress?.(Math.min(0.999, (passDone + inPass) / passes));
  let gainDb = 0;
  let summaryNorm: RenderSummary["normalise"];
  const ceilingDb = norm ? norm.truePeakDb - 0.3 : 0; // a little margin for resampling and dither
  let useLimiter = false;
  if (norm) {
    passes = 2; // measure + write (one more if the limiter has to work)
    const m = new LoudnessMeter(inRate, 1);
    const tp = new TruePeakMeter(1);
    let t = 0;
    for await (const x of mixPass()) {
      m.push([x]);
      tp.push([x]);
      t += x.length;
      await progress(t / Math.max(1, total));
    }
    passDone++;
    const inputLufs = m.integrated() + stereoOffset;
    let capped = false;
    if (Number.isFinite(inputLufs)) {
      gainDb = norm.targetLufs - inputLufs;
      if (gainDb > MAX_NORMALISE_GAIN_DB) {
        gainDb = MAX_NORMALISE_GAIN_DB;
        capped = true;
      }
    }
    useLimiter = tp.db() + gainDb > ceilingDb;
    // limiting lowers the loudness a little: measure with it in place and top the gain up (at most twice)
    let lastErr = Number.POSITIVE_INFINITY;
    for (let round = 0; useLimiter && round < 3 && !capped; round++) {
      passes++;
      const g = Math.pow(10, gainDb / 20);
      const lim = new TruePeakLimiter(inRate, 1, ceilingDb);
      const lm = new LoudnessMeter(inRate, 1);
      let n = 0;
      for await (const x of mixPass()) {
        const y = new Float32Array(x.length);
        for (let i = 0; i < x.length; i++) y[i] = x[i]! * g;
        lm.push(lim.process([y]));
        n += x.length;
        await progress(n / Math.max(1, total));
      }
      lm.push(lim.flush());
      passDone++;
      const err = norm.targetLufs - (lm.integrated() + stereoOffset);
      if (Math.abs(err) < 0.15) break;
      // more gain isn't buying loudness (the limiter takes it straight back): stop pushing
      if (Math.abs(err) > 0.8 * Math.abs(lastErr)) break;
      lastErr = err;
      gainDb = Math.min(MAX_NORMALISE_GAIN_DB, gainDb + err);
    }
    summaryNorm = { targetLufs: norm.targetLufs, truePeakDb: norm.truePeakDb, inputLufs, gainDb, capped, limitedSamples: 0, minLimiterGainDb: 0, reached: false };
  }

  // ---- the delivery pass ----
  yield wavHeaderBytes(frames, outRate, bitDepth, channels);
  const resampler = inRate === outRate ? null : new Resampler(inRate, outRate);
  const g = Math.pow(10, gainDb / 20);
  const limiter = norm && useLimiter ? new TruePeakLimiter(inRate, 1, ceilingDb) : null;
  let skip = limiter?.latency ?? 0; // the limiter's start-up delay
  const outMeter = new LoudnessMeter(outRate, channels);
  const outPeak = new TruePeakMeter(channels);

  const bytes = bitDepth / 8;
  const rnd = makeRng(0x9e3779b9);
  let peak = 0;
  let clipped = 0;
  let written = 0;
  const encode = (x: Float32Array): Uint8Array => {
    const chs = channels === 2 ? [x, x] : [x];
    outMeter.push(chs);
    outPeak.push(chs);
    const out = new Uint8Array(x.length * bytes * channels);
    const scale = bitDepth === 16 ? 32767 : 8388607;
    const lo = bitDepth === 16 ? -32768 : -8388608;
    for (let i = 0; i < x.length; i++) {
      const a = Math.abs(x[i]!);
      if (a > peak) peak = a;
      for (let c = 0; c < channels; c++) {
        let v = x[i]! * scale;
        if (bitDepth === 16) v += rnd() - rnd(); // TPDF dither, ±1 LSB
        let q = Math.round(v);
        if (q > scale) {
          q = scale;
          clipped++;
        } else if (q < lo) {
          q = lo;
          clipped++;
        }
        const o = (i * channels + c) * bytes;
        out[o] = q & 0xff;
        out[o + 1] = (q >> 8) & 0xff;
        if (bytes === 3) out[o + 2] = (q >> 16) & 0xff;
      }
    }
    written += x.length;
    return out;
  };
  /** gain → limiter (dropping its start-up delay) → resampler → encode */
  const shape = (x: Float32Array): Float32Array => {
    if (!norm) return x;
    let y = x;
    if (g !== 1) {
      y = new Float32Array(x.length);
      for (let i = 0; i < x.length; i++) y[i] = x[i]! * g;
    }
    if (!limiter) return y;
    let z = limiter.process([y])[0]!;
    if (skip > 0) {
      const drop = Math.min(skip, z.length);
      skip -= drop;
      z = z.subarray(drop);
    }
    return z;
  };

  let t = 0;
  for await (const mixed of mixPass()) {
    const shaped = shape(mixed);
    const pcm = resampler ? resampler.push(shaped) : shaped;
    if (pcm.length) yield encode(pcm);
    t += mixed.length;
    await progress(t / Math.max(1, total));
  }
  if (limiter) {
    let tail = limiter.flush()[0]!;
    if (skip > 0) tail = tail.subarray(Math.min(skip, tail.length));
    const pcm = resampler ? resampler.push(tail) : tail;
    if (pcm.length) yield encode(pcm);
  }
  if (resampler) {
    const rest = resampler.finish(total);
    if (rest.length) yield encode(rest);
  }
  if (written !== frames) throw new Error(`render wrote ${written} frames, expected ${frames}`);
  await opts.onProgress?.(1);
  const integratedLufs = outMeter.integrated();
  if (summaryNorm) {
    if (limiter) {
      summaryNorm.limitedSamples = limiter.limited;
      summaryNorm.minLimiterGainDb = limiter.minGain < 1 ? 20 * Math.log10(limiter.minGain) : 0;
    }
    summaryNorm.reached = Math.abs(integratedLufs - summaryNorm.targetLufs) <= 0.5;
  }
  return { frames, peak, clipped, channels, integratedLufs, truePeakDb: outPeak.db(), lra: outMeter.lra(), ...(summaryNorm ? { normalise: summaryNorm } : {}) };
}
