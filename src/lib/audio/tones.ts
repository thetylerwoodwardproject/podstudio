/*
 * Marker tones mixed into an exported recording: a short beep at each retake
 * (and, if chosen, coughs, ad-libs, pauses and gaps), so the places to edit
 * can be heard. The tones sit under the voice: while someone is talking they're
 * ducked, with an attack (how fast they drop when speech starts) and a release
 * (how fast they come back when it stops), like a sidechain ducker.
 */
import { tone } from './wav.ts';

export type ToneKind = 'retake' | 'cut' | 'adlib' | 'pause' | 'gap';

export interface ToneSettings {
  /** Include tones in exports by default */
  inExports: boolean;
  kinds: Record<ToneKind, boolean>;
  /** Tone level, dBFS */
  level: number;
  /** How far the tone drops under the voice, dB */
  duck: number;
  attackMs: number;
  releaseMs: number;
  /** Voice above this (dBFS, 5 ms RMS) ducks the tone */
  threshold: number;
}

export const defaultTones: ToneSettings = {
  inExports: false,
  kinds: { retake: true, cut: false, adlib: false, pause: false, gap: false },
  level: -20,
  duck: 12,
  attackMs: 10,
  releaseMs: 150,
  threshold: -40,
};

/** A pitch per marker kind, so they can be told apart by ear. */
export const TONE_FREQ: Record<ToneKind, number> = { retake: 1000, cut: 600, adlib: 1400, pause: 800, gap: 400 };
export const TONE_SECONDS = 0.2;
/** Voice before a tone the ducker looks at, so its state is settled when the tone starts. */
export const DUCK_PREROLL = 0.5;

/**
 * Gain for the tones at each sample of `voice` (mono): 1 while the voice is
 * quiet, down by `duck` dB while it's above the threshold, moving with the
 * attack and release time constants.
 */
export function duckGains(voice: Float32Array, rate: number, o: Pick<ToneSettings, 'duck' | 'attackMs' | 'releaseMs' | 'threshold'>): Float32Array {
  const out = new Float32Array(voice.length);
  const win = Math.max(1, Math.round(rate * 0.005));
  const ducked = 10 ** (-o.duck / 20);
  const thr = 10 ** (o.threshold / 20);
  const attack = Math.exp(-1 / Math.max(1, (o.attackMs / 1000) * rate));
  const release = Math.exp(-1 / Math.max(1, (o.releaseMs / 1000) * rate));
  let g = 1;
  for (let start = 0; start < voice.length; start += win) {
    const end = Math.min(voice.length, start + win);
    let sq = 0;
    for (let i = start; i < end; i++) sq += voice[i] * voice[i];
    const target = Math.sqrt(sq / (end - start)) > thr ? ducked : 1;
    for (let i = start; i < end; i++) {
      g = target + (g - target) * (target < g ? attack : release);
      out[i] = g;
    }
  }
  return out;
}

export interface PlacedTone {
  /** Frame (sample per channel) where the tone starts, in the recording */
  at: number;
  kind: ToneKind;
}

/**
 * Mix tones into a stretch of the recording that starts at frame `from`
 * (interleaved samples, `channels` wide). Returns a new array; samples beyond
 * the tones are unchanged. The stretch should begin DUCK_PREROLL before the first tone.
 */
export function mixTones(
  x: Float32Array,
  channels: number,
  rate: number,
  from: number,
  tones: PlacedTone[],
  o: Pick<ToneSettings, 'level' | 'duck' | 'attackMs' | 'releaseMs' | 'threshold'>,
): Float32Array {
  const frames = Math.floor(x.length / channels);
  const mono = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += x[f * channels + c];
    mono[f] = s / channels;
  }
  const gains = duckGains(mono, rate, o);
  const out = x.slice();
  for (const t of tones) {
    const beep = tone(rate, { freq: TONE_FREQ[t.kind], dbfs: o.level, seconds: TONE_SECONDS });
    const start = t.at - from;
    for (let i = 0; i < beep.length; i++) {
      const f = start + i;
      if (f < 0 || f >= frames) continue;
      const v = beep[i] * gains[f];
      for (let c = 0; c < channels; c++) out[f * channels + c] = Math.max(-1, Math.min(1, out[f * channels + c] + v));
    }
  }
  return out;
}

/**
 * Group tones into stretches to decode and mix: each covers the ducker's
 * pre-roll and the tone itself, and overlapping ones are merged.
 */
export function toneWindows(tones: PlacedTone[], rate: number, total: number): { from: number; to: number; tones: PlacedTone[] }[] {
  const pre = Math.round(DUCK_PREROLL * rate);
  const len = Math.round(TONE_SECONDS * rate);
  const out: { from: number; to: number; tones: PlacedTone[] }[] = [];
  for (const t of [...tones].sort((a, b) => a.at - b.at)) {
    if (t.at >= total) continue;
    const from = Math.max(0, t.at - pre);
    const to = Math.min(total, t.at + len);
    const last = out.at(-1);
    if (last && from <= last.to) {
      last.to = Math.max(last.to, to);
      last.tones.push(t);
    } else out.push({ from, to, tones: [t] });
  }
  return out;
}
