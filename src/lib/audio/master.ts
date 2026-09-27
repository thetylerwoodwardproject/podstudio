/*
 * The ready-to-publish episode: every speaker's edit (and the Pads track)
 * mixed into one file at a podcast loudness target, optionally with each
 * speaker levelled first.
 *
 *   pass 1  read every track in 5 s chunks, give each voice its tone (EQ and
 *           compressor, lib/audio/tone.ts), level the voices (writing
 *           levelled copies of each edit if asked), mix, and measure the
 *           integrated loudness of the mix (BS.1770);
 *   pass 2  the same mix again (levelling is deterministic), with the gain
 *           that reaches the target, through a −1 dBTP true-peak limiter,
 *           written out.
 *
 * Tracks come in as WAV Blobs, the files rangesWav() makes (so drift and gap
 * correction, cough mutes and noise suppression are already in them); a track
 * recorded at another rate is converted as it's read. Nothing large is held in
 * memory, and nothing here touches the originals.
 */
import { Leveler, LoudnessMeter, TruePeakLimiter, truePeak } from './loudness.ts';
import { ToneProcessor, toneActive, type VoiceTone } from './tone.ts';
import { pcmFloats, type BitDepth } from './wav.ts';
import { parseWav, type WavInfo } from './wav-read.ts';

export type Target = { lufs: number; channels: 1 | 2 } | null;

/** The usual podcast targets: −16 LUFS for stereo, −19 LUFS for mono (the same loudness heard). */
export const TARGETS = { stereo: { lufs: -16, channels: 2 as const }, mono: { lufs: -19, channels: 1 as const } };

export interface MasterTrack {
  wav: Blob;
  /** Level this track (voices yes, the Pads track no) */
  level: boolean;
  /** This person's EQ and compressor, before the leveller */
  tone?: VoiceTone;
  /** Where to write this track's levelled copy (its own rate and channels), if wanted */
  levelled?: (x: Float32Array) => Promise<void>;
}

export interface MasterResult {
  /** Integrated loudness of the mix before the gain, LUFS */
  measured: number;
  /** Gain applied, dB */
  gain: number;
  /** Loudness of the result, LUFS (measured again on what was written) */
  result: number;
  /** Loudness range of the result, LU (null for a very short file) */
  range: number | null;
  /** Highest true peak of the result, dBTP */
  truePeak: number;
  /** Short-term loudness of the result every second, LUFS */
  history: number[];
  frames: number;
}

/** Reads a WAV Blob in chunks of frames, as interleaved floats. */
export class WavReader {
  info!: WavInfo;
  frames = 0;
  private pos = 0;
  private blob: Blob;
  private constructor(blob: Blob) {
    this.blob = blob;
  }

  static async open(blob: Blob) {
    const r = new WavReader(blob);
    const head = new DataView(await blob.slice(0, Math.min(blob.size, 8192)).arrayBuffer());
    const info = parseWav(head);
    if (!info || info.format !== 'pcm') throw new Error('Not a PCM WAV');
    r.info = info;
    r.frames = Math.floor(Math.min(info.dataBytes, blob.size - info.dataOffset) / ((info.bitDepth / 8) * info.channels));
    return r;
  }

  /** Moves to a frame, for reading windows from anywhere in the file. */
  seek(frame: number) {
    this.pos = Math.max(0, Math.min(this.frames, Math.floor(frame)));
  }

  /** The next `n` frames (fewer at the end). */
  async read(n: number): Promise<Float32Array> {
    const bpf = (this.info.bitDepth / 8) * this.info.channels;
    const take = Math.max(0, Math.min(n, this.frames - this.pos));
    const from = this.info.dataOffset + this.pos * bpf;
    this.pos += take;
    if (!take) return new Float32Array(0);
    return pcmFloats(new Uint8Array(await this.blob.slice(from, from + take * bpf).arrayBuffer()), this.info.bitDepth as BitDepth);
  }
}

/**
 * Streaming sample-rate conversion (cubic Hermite), for a track recorded at a
 * different rate from the mix. Keeps its place between chunks.
 */
export class Resampler {
  private channels: number;
  private step: number;
  /** The next output's position in the run of [3 remembered frames, then this chunk] */
  private t = 3;
  private hist: Float32Array;
  constructor(from: number, to: number, channels: number) {
    this.channels = channels;
    this.step = from / to;
    this.hist = new Float32Array(3 * channels);
  }

  /** `x` in, as many frames out as its duration at the new rate (give or take one at the very end). */
  process(x: Float32Array): Float32Array {
    const ch = this.channels;
    const n = x.length / ch;
    const run = n + 3;
    const at = (f: number, c: number) => (f < 3 ? this.hist[f * ch + c] : x[(f - 3) * ch + c]);
    const out: number[] = [];
    // Each output needs the frames either side of it: floor(t) − 1 … floor(t) + 2.
    while (Math.floor(this.t) + 2 < run) {
      const i = Math.floor(this.t);
      const f = this.t - i;
      for (let c = 0; c < ch; c++) {
        const y0 = at(i - 1, c);
        const y1 = at(i, c);
        const y2 = at(i + 1, c);
        const y3 = at(i + 2, c);
        const a = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
        const b = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
        const cc = -0.5 * y0 + 0.5 * y2;
        out.push(((a * f + b) * f + cc) * f + y1);
      }
      this.t += this.step;
    }
    // The last three frames of this run start the next one.
    const keep = new Float32Array(3 * ch);
    for (let f = 0; f < 3; f++) for (let c = 0; c < ch; c++) keep[f * ch + c] = at(run - 3 + f, c);
    this.hist = keep;
    this.t -= n;
    return Float32Array.from(out);
  }
}

/** Into the mix's channel layout: mono tracks sit in the centre (L = R); stereo folds to mono by averaging. */
function toChannels(x: Float32Array, from: number, to: 1 | 2): Float32Array {
  if (from === to) return x;
  const frames = x.length / from;
  const out = new Float32Array(frames * to);
  for (let f = 0; f < frames; f++) {
    if (to === 2) out[2 * f] = out[2 * f + 1] = x[f];
    else out[f] = (x[2 * f] + x[2 * f + 1]) / 2;
  }
  return out;
}

const CHUNK_SECONDS = 5;

/**
 * Mix `tracks` into `write`, at `rate` and `channels`, reaching `target`
 * (null: no loudness change, only the peak limit), or turned up by a fixed
 * `gain` (dB) if one is given. The first track sets the length; others are
 * padded or cut to it.
 */
export async function renderMaster(
  tracks: MasterTrack[],
  o: { rate: number; channels: 1 | 2; lufs: number | null; levelling: boolean; gain?: number },
  write: (x: Float32Array) => Promise<void>,
  onProgress?: (stage: 'level' | 'master', done: number) => void,
): Promise<MasterResult> {
  const readers0 = await Promise.all(tracks.map((t) => WavReader.open(t.wav)));
  const lead = readers0[0];
  const total = Math.round((lead.frames * o.rate) / lead.info.sampleRate);
  const chunk = CHUNK_SECONDS * o.rate;

  /** One pass over the mix; `each` gets every chunk of it. */
  const pass = async (withCopies: boolean, each: (mix: Float32Array) => Promise<void> | void, stage: 'level' | 'master') => {
    const readers = await Promise.all(tracks.map((t) => WavReader.open(t.wav)));
    const levellers = readers.map((r, i) => (o.levelling && tracks[i].level ? new Leveler(r.info.sampleRate, r.info.channels) : null));
    const tones = readers.map((r, i) => (toneActive(tracks[i].tone) ? new ToneProcessor(r.info.sampleRate, r.info.channels, tracks[i].tone!) : null));
    const resamplers = readers.map((r) => (r.info.sampleRate === o.rate ? null : new Resampler(r.info.sampleRate, o.rate, r.info.channels)));
    const pending = readers.map(() => new Float32Array(0));
    for (let done = 0; done < total; done += chunk) {
      const n = Math.min(chunk, total - done);
      const mix = new Float32Array(n * o.channels);
      for (const [i, r] of readers.entries()) {
        const ch = r.info.channels;
        // Enough of this track, at the mix's rate, for n frames.
        while (pending[i].length / ch < n) {
          let x = await r.read(Math.ceil((chunk * r.info.sampleRate) / o.rate) + 4);
          if (!x.length) break;
          if (tones[i]) x = tones[i]!.process(x);
          if (levellers[i]) x = levellers[i]!.process(x);
          if (withCopies && tracks[i].levelled) await tracks[i].levelled!(x);
          if (resamplers[i]) x = resamplers[i]!.process(x);
          const joined = new Float32Array(pending[i].length + x.length);
          joined.set(pending[i]);
          joined.set(x, pending[i].length);
          pending[i] = joined;
        }
        const use = pending[i].subarray(0, Math.min(pending[i].length, n * ch));
        pending[i] = pending[i].slice(use.length);
        const y = toChannels(use, ch, o.channels);
        for (let k = 0; k < y.length; k++) mix[k] += y[k];
      }
      await each(mix);
      onProgress?.(stage, Math.min(1, (done + n) / total));
    }
    // Levelled copies: the rest of each track past the lead's length.
    if (withCopies)
      for (const [i, r] of readers.entries()) {
        if (!tracks[i].levelled) continue;
        for (let x = await r.read(chunk); x.length; x = await r.read(chunk)) {
          if (tones[i]) x = tones[i]!.process(x);
          await tracks[i].levelled!(levellers[i] ? levellers[i]!.process(x) : x);
        }
      }
  };

  const meter = new LoudnessMeter(o.rate, o.channels);
  await pass(true, (mix) => meter.push(mix), 'level');
  const measured = meter.integrated();
  const gainDb = o.gain ?? (o.lufs == null || !Number.isFinite(measured) ? 0 : Math.min(30, o.lufs - measured));
  const g = 10 ** (gainDb / 20);
  const limiter = new TruePeakLimiter(o.rate, o.channels, -1);
  const after = new LoudnessMeter(o.rate, o.channels);
  let tp = 0;
  const out = async (y: Float32Array) => {
    if (!y.length) return;
    after.push(y);
    // True peak: only chunks whose sample peak could beat it (between samples adds at most ~3 dB).
    let sp = 0;
    for (const v of y) sp = Math.max(sp, Math.abs(v));
    if (sp * 1.5 > tp) tp = Math.max(tp, truePeak(y, o.channels));
    await write(y);
  };
  await pass(
    false,
    async (mix) => {
      for (let k = 0; k < mix.length; k++) mix[k] *= g;
      await out(limiter.process(mix));
    },
    'master',
  );
  await out(limiter.flush());
  return { measured, gain: gainDb, result: after.integrated(), range: after.range(), truePeak: tp > 0 ? 20 * Math.log10(tp) : -Infinity, history: after.shortTerm(1), frames: total };
}
