// The shared audio render path (Stage 04): turns a project document into WAV bytes. The browser
// preview schedules the same plan (`planPieces`, `gainBreakpoints`); this walks it block by
// block on the server. Mono mixdown of every audible track (mute/solo honoured), clip gain and
// linear fades, optional 44.1 kHz conversion, 16-bit TPDF dither (seeded, so identical every
// run) or plain 24-bit. Streaming: memory is a few windows of source audio, not the episode.
import { panGains, projectLength, sourceChannels, triggerTrackIds, withCrossfades, type DuckRule, type ProjectDoc } from "./document";
import { duckGains, newDuckState, type DuckState } from "./duck";
import { WINDOW_SAMPLES, audibleTracks, gainBreakpoints, planPieces } from "./plan";
import { Resampler } from "./resample";
import { LoudnessMeter, TruePeakLimiter, TruePeakMeter } from "./loudness";
import { FX_LATENCY, FxChain, fxActive } from "./fx";

export interface RenderOptions {
  doc: ProjectDoc;
  bitDepth: 16 | 24;
  sampleRate: 44100 | 48000;
  /** Read `count` frames starting at `from` (clamped by the caller to the source length): one array per channel. */
  read: (sourceId: string, from: number, count: number) => Promise<Float32Array[]>;
  /** Called with 0..1 as output is produced. Throw (or abort) to stop. */
  onProgress?: (fraction: number) => void | Promise<void>;
  /** 1 (default) or 2: stereo is the mono mix on both channels. */
  channels?: 1 | 2;
  /**
   * Normalise to this integrated loudness with a true-peak ceiling (the podcast delivery step).
   * `marginDb` is the limiter's headroom under the ceiling (default 0.3 dB; the MP3 path raises it
   * when encoding overshoots). Absent = untouched mix.
   */
  loudness?: { targetLufs: number; truePeakDb: number; marginDb?: number };
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
  /** Problems with the material that the numbers alone would hide (silent, too short, very quiet, heavy limiting…). */
  diagnostics?: Diagnostic[];
}

export interface Diagnostic {
  code: "silent" | "short" | "quiet" | "heavy-limiting" | "missed-target";
  message: string;
}

/** Explain what a normalised render's numbers mean for the material. */
export function loudnessDiagnostics(s: Pick<RenderSummary, "frames" | "normalise">, rate: number): Diagnostic[] {
  const out: Diagnostic[] = [];
  const n = s.normalise;
  if (!n) return out;
  const seconds = s.frames / rate;
  if (!Number.isFinite(n.inputLufs)) out.push({ code: "silent", message: "The mix is silent (nothing above the −70 LUFS gate), so there was nothing to normalize." });
  else if (seconds < 3) out.push({ code: "short", message: `Only ${seconds.toFixed(1)} s long — too short for integrated loudness to mean much (it needs a few seconds of programme).` });
  if (n.capped) out.push({ code: "quiet", message: `The mix is very quiet (${n.inputLufs.toFixed(1)} LUFS); the boost is capped at +30 dB, so it stays under the target.` });
  if (n.minLimiterGainDb < -6) out.push({ code: "heavy-limiting", message: `The limiter had to pull peaks down by up to ${Math.abs(n.minLimiterGainDb).toFixed(1)} dB — the mix has very loud peaks for its loudness. Compression on the voice tracks would sound cleaner.` });
  if (Number.isFinite(n.inputLufs) && !n.reached && !n.capped) out.push({ code: "missed-target", message: `Landed more than 0.5 LU from ${n.targetLufs} LUFS.` });
  return out;
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

/** Reads a source window: one array per channel (1 for mono, 2 for stereo). */
export type WindowOf = (sourceId: string, win: number) => Promise<Float32Array[]>;

/**
 * Every audible track's audio for the timeline block [from, from + len): clip gain, fades and
 * crossfades applied; no ducking, FX, fader or pan yet. A track's block has 2 channels if any of
 * its pieces in the block come from a stereo source (mono pieces then play on both), else 1.
 */
export async function mixTrackBlocks(doc: ProjectDoc, from: number, len: number, windowOf: WindowOf, onlyTracks?: Set<string>): Promise<Map<string, Float32Array[]>> {
  const out = new Map<string, Float32Array[]>();
  const clips = withCrossfades(doc); // fades widened over crossfades
  const srcCh = new Map(doc.sources.map((s) => [s.id, sourceChannels(s)]));
  const pieces = planPieces(doc, from, from + len).filter((p) => !onlyTracks || onlyTracks.has(p.trackId));
  const trackCh = new Map<string, number>();
  for (const p of pieces) trackCh.set(p.trackId, Math.max(trackCh.get(p.trackId) ?? 1, srcCh.get(p.sourceId) ?? 1));
  for (const [id, ch] of trackCh) out.set(id, Array.from({ length: ch }, () => new Float32Array(len)));
  for (const p of pieces) {
    const clip = clips.get(p.clipId)!;
    const bufs = out.get(p.trackId)!;
    const win = await windowOf(p.sourceId, Math.floor(p.srcStart / WINDOW_SAMPLES));
    const off = p.srcStart % WINDOW_SAMPLES;
    const bp = gainBreakpoints(clip, p);
    for (let c = 0; c < bufs.length; c++) {
      const buf = bufs[c]!;
      const src = win[Math.min(c, win.length - 1)] ?? new Float32Array(0); // a mono piece feeds both sides
      for (let s = 0; s < bp.length - 1; s++) {
        const [t0, g0] = bp[s]!;
        const [t1, g1] = bp[s + 1]!;
        const span = t1 - t0;
        for (let t = t0; t < t1; t++) {
          const g = g0 + ((g1 - g0) * (t - t0)) / span;
          const i = t - from;
          buf[i] = buf[i]! + (src[off + (t - p.start)] ?? 0) * g;
        }
      }
    }
  }
  return out;
}

/** The trigger signal of a rule over a block: the loudest of its (audible) trigger tracks, any channel, at each sample. */
export function triggerSignal(doc: ProjectDoc, rule: DuckRule, tracks: Map<string, Float32Array[]>, len: number): Float32Array {
  const sig = new Float32Array(len);
  for (const id of triggerTrackIds(doc, rule)) {
    for (const t of tracks.get(id) ?? []) {
      for (let i = 0; i < len; i++) {
        const a = Math.abs(t[i]!);
        if (a > sig[i]!) sig[i] = a;
      }
    }
  }
  return sig;
}

/**
 * Mix one block of the timeline to stereo [L, R]. Per track: ducking → (FX, Stage 05) → fader → pan.
 * `states` carries ducking state between blocks.
 */
async function mixBlock(doc: ProjectDoc, from: number, len: number, windowOf: WindowOf, states: Map<string, DuckState>, chains: Map<string, FxChain> | null): Promise<[Float32Array, Float32Array]> {
  const tracks = await mixTrackBlocks(doc, from, len, windowOf);
  for (const rule of doc.ducking ?? []) {
    if (!rule.enabled) continue;
    let st = states.get(rule.id);
    if (!st) states.set(rule.id, (st = newDuckState()));
    // keep the follower running even when no trigger track has audio in this block
    const gains = duckGains(triggerSignal(doc, rule, tracks, len), rule, doc.sampleRate, st);
    for (const id of rule.targets) for (const t of tracks.get(id) ?? []) for (let i = 0; i < len; i++) t[i] = t[i]! * gains[i]!;
  }
  // FX: every audible track runs through its chain (silent stretches too, so tails and state carry
  // on exactly as in the preview); a chain with nothing on is just the matching delay
  if (chains) {
    for (const [id, chain] of chains) {
      const input = tracks.get(id) ?? Array.from({ length: chain.channels }, () => new Float32Array(len));
      tracks.set(id, chain.process(input));
    }
  }
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  for (const [id, chs] of tracks) {
    const tr = doc.tracks.find((t) => t.id === id);
    const g = tr?.gainDb ? Math.pow(10, tr.gainDb / 20) : 1; // the fader
    const [pl, pr] = panGains(tr?.pan);
    const l = chs[0]!;
    const r = chs[1] ?? chs[0]!;
    const gl = g * pl;
    const gr = g * pr;
    for (let i = 0; i < len; i++) {
      L[i] = L[i]! + l[i]! * gl;
      R[i] = R[i]! + r[i]! * gr;
    }
  }
  return [L, R];
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
  const makeWindowOf = (): WindowOf => {
    const cache = new Map<string, Promise<Float32Array[]>>();
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
  /** The mix in the output's layout, one block at a time: mono = (L+R)/2, stereo = [L, R]. */
  // FX anywhere → every audible track gets a chain (constant FX_LATENCY), the mix is FX_LATENCY late:
  // render that much further and drop that much from the start
  const withFx = doc.tracks.some((t) => fxActive(t.fx));
  const audible = audibleTracks(doc);
  const lat = withFx ? FX_LATENCY : 0;
  async function* mixPass(): AsyncGenerator<Float32Array[]> {
    const windowOf = makeWindowOf();
    const duckStates = new Map<string, DuckState>();
    const chains = withFx
      ? new Map(
          doc.tracks
            .filter((t) => audible.has(t.id))
            .map((t) => [t.id, new FxChain(inRate, doc.clips.some((c) => c.trackId === t.id && doc.sources.find((x) => x.id === c.sourceId)?.channels === 2) ? 2 : 1, fxActive(t.fx) ? t.fx : undefined)] as const),
        )
      : null;
    let skip = lat;
    for (let t = 0; t < total + lat; t += BLOCK) {
      let [L, R] = await mixBlock(doc, t, Math.min(BLOCK, total + lat - t), windowOf, duckStates, chains);
      if (skip > 0) {
        const drop = Math.min(skip, L.length);
        skip -= drop;
        L = L.subarray(drop);
        R = R.subarray(drop);
        if (!L.length) continue;
      }
      if (channels === 2) yield [L, R];
      else {
        const m = new Float32Array(L.length);
        for (let i = 0; i < m.length; i++) m[i] = (L[i]! + R[i]!) / 2;
        yield [m];
      }
    }
  }
  const scaled = (x: Float32Array[], g: number) =>
    g === 1
      ? x
      : x.map((c) => {
          const y = new Float32Array(c.length);
          for (let i = 0; i < c.length; i++) y[i] = c[i]! * g;
          return y;
        });

  // ---- normalisation: measure, decide the gain, and correct for what the limiter takes off ----
  const norm = opts.loudness;
  let passes = 1;
  let passDone = 0;
  const progress = async (inPass: number) => opts.onProgress?.(Math.min(0.999, (passDone + inPass) / passes));
  let gainDb = 0;
  let summaryNorm: RenderSummary["normalise"];
  const ceilingDb = norm ? norm.truePeakDb - (norm.marginDb ?? 0.3) : 0; // a little margin for resampling, dither and encoding
  let useLimiter = false;
  if (norm) {
    passes = 2; // measure + write (more if the limiter has to work)
    const m = new LoudnessMeter(inRate, channels);
    const tp = new TruePeakMeter(channels);
    let t = 0;
    for await (const x of mixPass()) {
      m.push(x);
      tp.push(x);
      t += x[0]!.length;
      await progress(t / Math.max(1, total));
    }
    passDone++;
    const inputLufs = m.integrated();
    let capped = false;
    if (Number.isFinite(inputLufs)) {
      gainDb = norm.targetLufs - inputLufs;
      if (gainDb > MAX_NORMALISE_GAIN_DB) {
        gainDb = MAX_NORMALISE_GAIN_DB;
        capped = true;
      }
    }
    useLimiter = tp.db() + gainDb > ceilingDb;
    // limiting lowers the loudness a little: measure with it in place and top the gain up
    let lastErr = Number.POSITIVE_INFINITY;
    for (let round = 0; useLimiter && round < 3 && !capped; round++) {
      passes++;
      const g = Math.pow(10, gainDb / 20);
      const lim = new TruePeakLimiter(inRate, channels, ceilingDb);
      const lm = new LoudnessMeter(inRate, channels);
      let n = 0;
      for await (const x of mixPass()) {
        lm.push(lim.process(scaled(x, g)));
        n += x[0]!.length;
        await progress(n / Math.max(1, total));
      }
      lm.push(lim.flush());
      passDone++;
      const err = norm.targetLufs - lm.integrated();
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
  const resamplers = inRate === outRate ? null : Array.from({ length: channels }, () => new Resampler(inRate, outRate));
  const g = Math.pow(10, gainDb / 20);
  const limiter = norm && useLimiter ? new TruePeakLimiter(inRate, channels, ceilingDb) : null;
  let skip = limiter?.latency ?? 0; // the limiter's start-up delay
  const outMeter = new LoudnessMeter(outRate, channels);
  const outPeak = new TruePeakMeter(channels);

  const bytes = bitDepth / 8;
  const rnd = makeRng(0x9e3779b9);
  let peak = 0;
  let clipped = 0;
  let written = 0;
  const encode = (chs: Float32Array[]): Uint8Array => {
    outMeter.push(chs);
    outPeak.push(chs);
    const n = chs[0]!.length;
    const out = new Uint8Array(n * bytes * channels);
    const scale = bitDepth === 16 ? 32767 : 8388607;
    const lo = bitDepth === 16 ? -32768 : -8388608;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < channels; c++) {
        const x = chs[c]![i]!;
        const a = Math.abs(x);
        if (a > peak) peak = a;
        let v = x * scale;
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
    written += n;
    return out;
  };
  /** gain → limiter (dropping its start-up delay) */
  const shape = (x: Float32Array[]): Float32Array[] => {
    if (!norm) return x;
    const y = scaled(x, g);
    if (!limiter) return y;
    let z = limiter.process(y);
    if (skip > 0) {
      const drop = Math.min(skip, z[0]!.length);
      skip -= drop;
      z = z.map((c) => c.subarray(drop));
    }
    return z;
  };
  const resample = (x: Float32Array[]) => (resamplers ? x.map((c, i) => resamplers[i]!.push(c)) : x);

  let t = 0;
  for await (const mixed of mixPass()) {
    const pcm = resample(shape(mixed));
    if (pcm[0]!.length) yield encode(pcm);
    t += mixed[0]!.length;
    await progress(t / Math.max(1, total));
  }
  if (limiter) {
    let tail = limiter.flush();
    if (skip > 0) tail = tail.map((c) => c.subarray(Math.min(skip, c.length)));
    const pcm = resample(tail);
    if (pcm[0]!.length) yield encode(pcm);
  }
  if (resamplers) {
    const rest = resamplers.map((r) => r.finish(total));
    if (rest[0]!.length) yield encode(rest);
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
  const done: RenderSummary = { frames, peak, clipped, channels, integratedLufs, truePeakDb: outPeak.db(), lra: outMeter.lra(), ...(summaryNorm ? { normalise: summaryNorm } : {}) };
  if (summaryNorm) done.diagnostics = loudnessDiagnostics(done, outRate);
  return done;
}
