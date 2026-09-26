/*
 * The Tone card's preview: 30 s of the episode through the same chain as the
 * export (renderMaster: each person's tone, the leveller if it's on, the
 * loudness target and the true-peak limiter), so what you hear, and what the
 * loudness meter reads, is what the export makes. "Original" is the same
 * chain with everyone's tone off, at the same loudness, so the comparison is
 * about tone and not level.
 *
 * Changing a setting renders the excerpt again (about a second) and playback
 * carries on from the same place.
 */
import { renderMaster, WavReader, type MasterTrack } from './master.ts';
import { LoudnessMeter, truePeak } from './loudness.ts';
import { windowSpectrum } from './spectrum.ts';
import { flatTone, type VoiceTone } from './tone.ts';
import type { Point } from '../graph.ts';

export interface PreviewInput {
  /** The person's key (their tone in the map), or null for the Pads track */
  key: string | null;
  wav: Blob;
}
export interface PreviewOptions {
  rate: number;
  channels: 1 | 2;
  lufs: number | null;
  levelling: boolean;
}
interface Rendered {
  mix: Float32Array;
  /** Each person's audio after their tone (and the leveller), at their own rate and channels */
  voices: Map<string, { x: Float32Array; rate: number; channels: number }>;
}

const all = async (wav: Blob) => {
  const r = await WavReader.open(wav);
  const x = await r.read(r.frames);
  return { x, rate: r.info.sampleRate, channels: r.info.channels };
};

export class TonePreview {
  private inputs: PreviewInput[];
  private o: PreviewOptions;
  private raw = new Map<string, { x: Float32Array; rate: number; channels: number }>();
  private original: Rendered | null = null;
  toned: Rendered | null = null;
  /** Loudness of the toned mix: momentary and short-term every 100 ms, true peak per 100 ms */
  meter: { momentary: number[]; short: number[]; peaks: number[]; range: number | null } | null = null;
  private ctx: AudioContext | null = null;
  private sources: { src: AudioBufferSourceNode; gain: GainNode; which: 'original' | 'tone' }[] = [];
  private t0 = 0;
  private offset = 0;
  ab: 'original' | 'tone' = 'tone';
  playing = false;

  constructor(inputs: PreviewInput[], o: PreviewOptions) {
    this.inputs = inputs;
    this.o = o;
  }

  get seconds() {
    return this.toned ? this.toned.mix.length / this.o.channels / this.o.rate : 0;
  }

  private async renderWith(tones: Record<string, VoiceTone>): Promise<Rendered> {
    const join = (a: Float32Array[]) => {
      const y = new Float32Array(a.reduce((n, p) => n + p.length, 0));
      let o = 0;
      for (const p of a) (y.set(p, o), (o += p.length));
      return y;
    };
    // Each person's processed audio comes back through the levelled-copy hook.
    const parts = new Map<string, Float32Array[]>();
    const tracks: MasterTrack[] = this.inputs.map((p) => {
      if (p.key == null) return { wav: p.wav, level: false };
      const chunks: Float32Array[] = [];
      parts.set(p.key, chunks);
      return { wav: p.wav, level: true, tone: tones[p.key], levelled: async (x) => void chunks.push(x.slice()) };
    });
    const out: Float32Array[] = [];
    await renderMaster(tracks, this.o, async (x) => void out.push(x.slice()));
    const voices: Rendered['voices'] = new Map();
    for (const [k, chunks] of parts) {
      const raw = this.raw.get(k)!;
      voices.set(k, { x: join(chunks), rate: raw.rate, channels: raw.channels });
    }
    return { mix: join(out), voices };
  }

  /** Renders with these tones (and the original, once). */
  async render(tones: Record<string, VoiceTone>) {
    if (!this.raw.size) for (const p of this.inputs) if (p.key != null) this.raw.set(p.key, await all(p.wav));
    if (!this.original) {
      const flat = Object.fromEntries(this.inputs.filter((p) => p.key != null).map((p) => [p.key!, flatTone()]));
      this.original = await this.renderWith(flat);
    }
    this.toned = await this.renderWith(tones);
    const ch = this.o.channels, rate = this.o.rate;
    const m = new LoudnessMeter(rate, ch);
    m.push(this.toned.mix);
    const block = Math.round(rate / 10) * ch;
    const peaks: number[] = [];
    for (let i = 0; i < this.toned.mix.length; i += block) {
      const tp = truePeak(this.toned.mix.subarray(i, i + block), ch);
      peaks.push(tp > 0 ? 20 * Math.log10(tp) : -Infinity);
    }
    this.meter = { momentary: m.momentary(), short: m.shortTerm(0.1), peaks, range: m.range() };
    if (this.playing) this.restart();
  }

  private buffer(x: Float32Array) {
    const ch = this.o.channels;
    const b = this.ctx!.createBuffer(ch, x.length / ch, this.o.rate);
    for (let c = 0; c < ch; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = x[i * ch + c];
    }
    return b;
  }

  /** Where playback is, in seconds into the excerpt. */
  position(): number {
    if (!this.ctx || !this.playing) return this.offset;
    const len = this.seconds || 1;
    return (this.offset + this.ctx.currentTime - this.t0) % len;
  }

  private restart() {
    const at = this.position();
    this.stopSources();
    this.startAt(at);
  }

  private stopSources() {
    for (const s of this.sources) s.src.stop();
    this.sources = [];
  }

  private startAt(at: number) {
    if (!this.ctx || !this.toned || !this.original) return;
    const when = this.ctx.currentTime + 0.02;
    for (const [which, r] of [['original', this.original], ['tone', this.toned]] as const) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer(r.mix);
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = which === this.ab ? 1 : 0;
      src.connect(gain).connect(this.ctx.destination);
      src.start(when, at % src.buffer.duration);
      this.sources.push({ src, gain, which });
    }
    this.t0 = when;
    this.offset = at;
  }

  async play() {
    this.ctx ??= new AudioContext({ sampleRate: this.o.rate });
    await this.ctx.resume();
    this.playing = true;
    this.startAt(this.offset);
  }

  stop() {
    this.offset = this.position();
    this.stopSources();
    this.playing = false;
  }

  setAb(which: 'original' | 'tone') {
    this.ab = which;
    if (!this.ctx) return;
    for (const s of this.sources) s.gain.gain.setTargetAtTime(s.which === which ? 1 : 0, this.ctx.currentTime, 0.01);
  }

  /** The loudness of the toned mix at a moment: momentary, short-term, integrated so far, true peak so far. */
  loudnessAt(t: number) {
    const m = this.meter!;
    const i = Math.floor(t * 10);
    const momentary = i >= 3 ? m.momentary[Math.min(m.momentary.length - 1, i - 3)] : -Infinity;
    const short = m.short[Math.min(m.short.length - 1, i)] ?? -Infinity;
    // Integrated over the blocks so far, with the −70 and −10 LU gates
    const e = m.momentary.slice(0, Math.max(0, i - 2)).map((l) => 10 ** ((l + 0.691) / 10));
    const abs = e.filter((x) => -0.691 + 10 * Math.log10(x) > -70);
    let integrated = -Infinity;
    if (abs.length) {
      const rel = -0.691 + 10 * Math.log10(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
      const g = abs.filter((x) => -0.691 + 10 * Math.log10(x) > rel);
      integrated = -0.691 + 10 * Math.log10(g.reduce((a, b) => a + b, 0) / g.length);
    }
    const peak = Math.max(-Infinity, ...m.peaks.slice(0, i + 1));
    return { momentary, short, integrated, peak, range: m.range, history: m.short, seconds: this.seconds, now: t };
  }

  /** One person's spectrum at a moment (after their tone), relative dB with its top at +18, and their level going in. */
  voiceAt(key: string, t: number): { spectrum: Point[] | null; level: number | null } {
    const v = this.toned?.voices.get(key);
    const raw = this.raw.get(key);
    if (!v || !raw) return { spectrum: null, level: null };
    const N = 4096;
    const at = Math.floor(t * v.rate);
    if (at + N > v.x.length / v.channels) return { spectrum: null, level: null };
    const mono = new Float32Array(N);
    let loud = 0;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let c = 0; c < v.channels; c++) s += v.x[(at + i) * v.channels + c];
      mono[i] = s / v.channels;
      loud += mono[i] * mono[i];
    }
    let spectrum: Point[] | null = null;
    if (loud / N > 1e-7) {
      const pts = windowSpectrum(mono, v.rate);
      const top = Math.max(...pts.map((p) => p[1]));
      spectrum = pts.map(([f, d]) => [f, d - top + 18]);
    }
    // The raw voice's peak over the last 50 ms, going into the compressor
    const r0 = Math.floor(t * raw.rate), span = Math.floor(0.05 * raw.rate);
    let pk = 0;
    for (let i = Math.max(0, r0 - span); i < Math.min(raw.x.length / raw.channels, r0); i++)
      for (let c = 0; c < raw.channels; c++) pk = Math.max(pk, Math.abs(raw.x[i * raw.channels + c]));
    return { spectrum, level: pk > 1e-6 ? Math.max(-60, 20 * Math.log10(pk)) : -60 };
  }

  close() {
    this.stopSources();
    this.ctx?.close();
    this.ctx = null;
    this.playing = false;
  }
}
