/*
 * The Pads track, rebuilt from the session's press log (handoff §7, 1c).
 *
 * Every press is logged with a copy of its pad's settings, the fixed library
 * file it played and when it stopped, so the track can be rendered at export
 * sample-accurately on the mic's clock, instead of being recorded from the
 * speakers' output. Ducking is rebuilt from the recorded mic with the same
 * envelope the live ducker uses (attack, release, threshold), so it comes out
 * as it was heard.
 *
 * Presses are on the session's wall clock, like markers. When the mic stopped
 * (a gap), the mic track has no audio for that stretch, so neither does this.
 */
import { audioTime, merge, type Range, type SessionMarker } from './assemble.ts';

export interface PadPress {
  /** Wall-clock seconds, like markers */
  t: number;
  key: number;
  padId: string;
  name: string;
  color: string;
  fileId: string;
  mode: 'oneshot' | 'loop' | 'hold';
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  trimStart: number;
  trimEnd: number;
  duck: boolean;
  duckDb: number;
  /** When it was stopped (second press, release, stop all), wall clock */
  stop?: number;
  /** Seconds it faded over from `stop` (0 = a click-free cut) */
  stopFade?: number;
  /** Level rides while it played (press and slide on a phone): from t on, the pad is at db */
  levels?: { t: number; db: number }[];
}

export interface PadLog {
  presses: PadPress[];
  /** Pads volume changes: from wall-clock t on, the pads bus is at db */
  volume: { t: number; db: number }[];
  /** The ducker's settings during the session */
  duck?: DuckOptions;
}

export interface DuckOptions {
  attackMs: number;
  releaseMs: number;
  threshold: number;
}

/** Interleaved stereo audio of a library file */
export interface PadAudio {
  rate: number;
  data: Float32Array;
}

/** A stop without a fade still ramps this long, so it doesn't click. */
export const DECLICK = 0.01;

const dbToGain = (db: number) => 10 ** (db / 20);

/** When a press stops sounding, wall clock (Infinity for a loop never stopped). */
export function pressEnd(p: PadPress, fileSeconds: number): number {
  const len = playLength(p, fileSeconds);
  const stopped = p.stop != null ? p.stop + Math.max(DECLICK, p.stopFade ?? 0) : Infinity;
  return p.mode === 'loop' ? stopped : Math.min(stopped, p.t + len);
}

export function playLength(p: Pick<PadPress, 'trimStart' | 'trimEnd'>, fileSeconds: number) {
  return Math.max(0, (p.trimEnd > 0 ? Math.min(p.trimEnd, fileSeconds) : fileSeconds) - p.trimStart);
}

/**
 * Gain of a press `pos` seconds after it started, at wall time `wall`: fades
 * in and out, and the stop's fade. 0 once it's over.
 */
export function pressGain(p: PadPress, pos: number, wall: number, len: number, base = dbToGain(p.gainDb)): number {
  if (pos < 0) return 0;
  if (p.mode !== 'loop' && pos >= len) return 0;
  let g = base;
  if (p.fadeInMs > 0) g *= Math.min(1, pos / (p.fadeInMs / 1000));
  if (p.mode !== 'loop' && p.fadeOutMs > 0) g *= Math.min(1, (len - pos) / (p.fadeOutMs / 1000));
  if (p.stop != null && wall >= p.stop) {
    const fade = Math.max(DECLICK, p.stopFade ?? 0);
    g *= Math.max(0, 1 - (wall - p.stop) / fade);
  }
  return g;
}

/** Wall-clock time of audio time `a` (the inverse of audioTime: gaps put back). */
export function wallTime(a: number, gaps: Range[]): number {
  let shift = 0;
  for (const [s, e] of gaps) {
    if (audioTime(s, gaps) > a) break;
    shift += e - s;
  }
  return a + shift;
}

/**
 * Renders the Pads track in order, a chunk at a time, alongside the mic's
 * audio (mono) for ducking. Call render() with consecutive chunks from frame 0.
 */
export class PadRenderer {
  private log: PadLog;
  private audio: Map<string, PadAudio>;
  private rate: number;
  private gaps: Range[];
  private duck: DuckOptions;
  private at = 0;
  /** Ducking envelope: 0 = no voice, 1 = fully ducked */
  private env = 0;
  private presses: (PadPress & { end: number; len: number; base: number })[];

  constructor(log: PadLog, audio: Map<string, PadAudio>, rate: number, markers: SessionMarker[], duck: DuckOptions) {
    this.log = log;
    this.audio = audio;
    this.rate = rate;
    this.duck = duck;
    this.gaps = merge(markers.filter((m) => m.kind === 'gap' && m.end != null).map((m) => [m.t, m.end!] as Range));
    this.presses = log.presses
      .filter((p) => audio.has(p.fileId))
      .map((p) => {
        const a = audio.get(p.fileId)!;
        const seconds = a.data.length / 2 / a.rate;
        return { ...p, len: playLength(p, seconds), end: pressEnd(p, seconds), base: dbToGain(p.gainDb) };
      })
      .sort((x, y) => x.t - y.t);
  }

  private volumeAt(wall: number) {
    let db = this.log.volume[0]?.db ?? 0;
    for (const v of this.log.volume) if (v.t <= wall) db = v.db;
    return dbToGain(db);
  }

  /** The next `mic.length` frames of the Pads track, interleaved stereo. */
  render(mic: Float32Array): Float32Array {
    const frames = mic.length;
    const out = new Float32Array(frames * 2);
    const rate = this.rate;
    const from = this.at;
    this.at += frames;

    // Voice envelope from 5 ms RMS windows, as in duckGains().
    const env = new Float32Array(frames);
    const win = Math.max(1, Math.round(rate * 0.005));
    const thr = dbToGain(this.duck.threshold);
    const attack = Math.exp(-1 / Math.max(1, (this.duck.attackMs / 1000) * rate));
    const release = Math.exp(-1 / Math.max(1, (this.duck.releaseMs / 1000) * rate));
    let e = this.env;
    for (let start = 0; start < frames; start += win) {
      const end = Math.min(frames, start + win);
      let sq = 0;
      for (let i = start; i < end; i++) sq += mic[i] * mic[i];
      const target = Math.sqrt(sq / (end - start)) > thr ? 1 : 0;
      for (let i = start; i < end; i++) {
        e = target + (e - target) * (target > e ? attack : release);
        env[i] = e;
      }
    }
    this.env = e;

    // Blocks of 128 frames share one wall-clock offset (they only differ across a gap).
    const BLOCK = 128;
    for (let b0 = 0; b0 < frames; b0 += BLOCK) {
      const b1 = Math.min(frames, b0 + BLOCK);
      const wall0 = wallTime((from + b0) / rate, this.gaps);
      const wall1 = wall0 + (b1 - b0) / rate;
      const vol = this.volumeAt(wall0);
      for (const p of this.presses) {
        if (p.t >= wall1) break;
        if (p.end <= wall0) continue;
        const a = this.audio.get(p.fileId)!;
        const fileFrames = a.data.length / 2;
        const ducked = dbToGain(-p.duckDb);
        let base = p.base;
        if (p.levels) for (const l of p.levels) if (l.t <= wall0) base = dbToGain(l.db);
        for (let i = b0; i < b1; i++) {
          const wall = wall0 + (i - b0) / rate;
          const pos = wall - p.t;
          const g = pressGain(p, pos, wall, p.len, base);
          if (!g) continue;
          const src = p.trimStart + (p.mode === 'loop' && p.len > 0 ? pos % p.len : pos);
          const x = src * a.rate;
          const j = Math.floor(x);
          if (j < 0 || j >= fileFrames) continue;
          const f = x - j;
          const k = Math.min(fileFrames - 1, j + 1);
          const duck = p.duck ? 1 + env[i] * (ducked - 1) : 1;
          const gain = g * vol * duck;
          out[2 * i] += (a.data[2 * j] * (1 - f) + a.data[2 * k] * f) * gain;
          out[2 * i + 1] += (a.data[2 * j + 1] * (1 - f) + a.data[2 * k + 1] * f) * gain;
        }
      }
    }
    return out;
  }
}

/**
 * Mic plus pads in one file, for a quick listen: summed, with a limiter so
 * peaks stay under -1 dBFS. `mic` is `micChannels` wide, `pads` stereo; the
 * result is stereo. The limiter's gain carries across calls through `state`.
 */
export function roughMix(mic: Float32Array, micChannels: number, pads: Float32Array, state: { g: number }, rate: number): Float32Array {
  const frames = pads.length / 2;
  const out = new Float32Array(frames * 2);
  const ceiling = dbToGain(-1);
  const release = Math.exp(-1 / (0.2 * rate));
  let g = state.g;
  for (let f = 0; f < frames; f++) {
    const m0 = mic[f * micChannels] ?? 0;
    const m1 = micChannels > 1 ? mic[f * micChannels + 1] : m0;
    const l = m0 + pads[2 * f];
    const r = m1 + pads[2 * f + 1];
    const peak = Math.max(Math.abs(l), Math.abs(r));
    // Instant attack, 200 ms release.
    const need = peak * g > ceiling ? ceiling / peak : 1;
    g = need < g ? need : 1 + (g - 1) * release;
    if (peak * g > ceiling) g = ceiling / peak;
    out[2 * f] = l * g;
    out[2 * f + 1] = r * g;
  }
  state.g = g;
  return out;
}
