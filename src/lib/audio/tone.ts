/*
 * Tone for one speaker at export: a ten-band graphic EQ, then a compressor.
 * Applied to each person's edit before the leveller and the mix
 * (renderMaster); the recordings never change.
 *
 *   EQ          peaking filters about an octave wide (Q 1.41) at 31 Hz … 16 kHz,
 *               ±12 dB each (RBJ cookbook coefficients).
 *   Compressor  feed-forward with a soft knee: the level is a peak envelope
 *               of the loudest channel (50 ms release, so a steady tone
 *               reads steady), the gain reduction follows it with a 10 ms
 *               attack and 150 ms release, and make-up gain comes last.
 *
 * Also the pieces the Tone card draws: the EQ's response, the compressor's
 * curve, the presets, a speech target and "Match to target".
 * Like lib/audio/loudness.ts, it streams: state carries between chunks.
 */

export const BANDS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_Q = 1.41;
export const EQ_RANGE = 12;

export interface EqSettings {
  on: boolean;
  /** dB per band, −12 … +12 */
  gains: number[];
  preset: string | null;
}
export interface CompSettings {
  on: boolean;
  threshold: number;
  ratio: number;
  knee: number;
  makeup: number;
  preset: string | null;
}
export interface VoiceTone {
  eq: EqSettings;
  comp: CompSettings;
}

export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Warm: [0, 2, 2, 1, 0, 0, -1, -1, -2, -2],
  Clear: [-6, -3, 0, -2, -1, 0, 1, 3, 2, 0],
  'De-mud': [0, 0, -1, -4, -3, -1, 0, 1, 0, 0],
  Radio: [-12, -6, 2, -2, 0, 2, 3, 3, -4, -10],
};
/** About 3, 6 and 10 dB off the loudest words. Off is the compressor switched off. */
export const COMP_PRESETS: Record<string, Omit<CompSettings, 'on' | 'preset'>> = {
  Light: { threshold: -24, ratio: 2, knee: 12, makeup: 3 },
  Medium: { threshold: -20, ratio: 3, knee: 8, makeup: 5 },
  Heavy: { threshold: -16, ratio: 5, knee: 4, makeup: 7 },
};
export const COMP_HELP: Record<string, string> = {
  Off: 'No compression.',
  Light: 'Evens out peaks by about 3 dB. Sounds natural.',
  Medium: 'About 6 dB on loud words. The usual spoken-word setting.',
  Heavy: 'Up to 10 dB. Dense and upfront, like radio.',
};
/** The presets' names before the step flow, as remembered settings may still have them. */
const OLD_COMP: Record<string, string> = { Gentle: 'Light', Voice: 'Medium', Broadcast: 'Heavy' };

/** Off: a flat EQ and no compression, so the voice goes through untouched. */
export const flatTone = (): VoiceTone => ({
  eq: { on: false, gains: [...EQ_PRESETS.Flat], preset: 'Flat' },
  comp: { on: false, ...COMP_PRESETS.Medium, preset: 'Medium' },
});

export const eqActive = (t: VoiceTone) => t.eq.on && t.eq.gains.some((g) => g !== 0);

/** A few words for a tone: "EQ Warm, compressor Medium", "custom EQ", "flat". */
export function toneSummary(t: VoiceTone): string {
  const parts: string[] = [];
  if (eqActive(t)) parts.push(t.eq.preset && t.eq.preset !== 'Flat' ? `EQ ${t.eq.preset}` : 'custom EQ');
  if (t.comp.on) parts.push(t.comp.preset ? `compressor ${t.comp.preset}` : 'custom compressor');
  return parts.join(', ') || 'flat';
}
export const toneActive = (t: VoiceTone | undefined): t is VoiceTone => !!t && (eqActive(t) || t.comp.on);

/** A settings object from storage, with anything missing or out of range put right. */
export function cleanTone(t: Partial<VoiceTone> | undefined): VoiceTone {
  const base = flatTone();
  const gains = Array.isArray(t?.eq?.gains) && t!.eq!.gains.length === BANDS.length ? t!.eq!.gains.map((g) => clamp(Math.round(Number(g) || 0), -EQ_RANGE, EQ_RANGE)) : base.eq.gains;
  const c = { ...base.comp, ...(t?.comp ?? {}) };
  return {
    eq: { on: !!t?.eq?.on, gains, preset: t?.eq ? (typeof t.eq.preset === 'string' ? t.eq.preset : null) : base.eq.preset },
    comp: {
      on: !!c.on,
      threshold: clamp(Number(c.threshold), -40, 0),
      ratio: clamp(Number(c.ratio), 1, 10),
      knee: clamp(Number(c.knee), 0, 18),
      makeup: clamp(Number(c.makeup), 0, 12),
      preset: typeof c.preset === 'string' ? (OLD_COMP[c.preset] ?? c.preset) : null,
    },
  };
}

const clamp = (x: number, lo: number, hi: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo);

/** Peaking biquad coefficients, normalised: [b0, b1, b2, a1, a2]. */
export function peaking(fc: number, gainDb: number, rate: number, q = EQ_Q): [number, number, number, number, number] {
  const A = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * fc) / rate;
  const alpha = Math.sin(w0) / (2 * q);
  const cw = Math.cos(w0);
  const a0 = 1 + alpha / A;
  return [(1 + alpha * A) / a0, (-2 * cw) / a0, (1 - alpha * A) / a0, (-2 * cw) / a0, (1 - alpha / A) / a0];
}

/** Bands that can be used at this rate (a 16 kHz band needs more than 32 kHz). */
const usable = (fc: number, rate: number) => fc < rate * 0.45;

/** The EQ's response at `f` Hz, in dB. */
export function eqResponse(f: number, gains: number[], rate = 48000): number {
  let sum = 0;
  const w = (2 * Math.PI * f) / rate;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  gains.forEach((g, i) => {
    if (!g || !usable(BANDS[i], rate)) return;
    const [b0, b1, b2, a1, a2] = peaking(BANDS[i], g, rate);
    const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
    const dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
    sum += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  });
  return sum;
}

/** The compressor's output level for an input level (dB), before make-up; soft knee. */
export function compCurve(x: number, c: Pick<CompSettings, 'threshold' | 'ratio' | 'knee'>): number {
  const { threshold: T, ratio: R, knee: W } = c;
  if (2 * (x - T) < -W) return x;
  if (W > 0 && 2 * Math.abs(x - T) <= W) return x + ((1 / R - 1) * (x - T + W / 2) ** 2) / (2 * W);
  return T + (x - T) / R;
}

/**
 * The speech target the Tone card draws and matches to: a low cut under
 * 80 Hz, a touch less low-mid, a little presence around 3–5 kHz, easing off
 * at the very top. Relative dB.
 */
const TARGET: [number, number][] = [[20, -22], [45, -12], [80, -1], [120, 0], [300, -0.5], [600, -1], [1200, 0], [2500, 1.5], [4500, 2.5], [7000, 1], [11000, -1.5], [20000, -8]];
export function speechTarget(f: number): number {
  const x = Math.log10(f);
  if (x <= Math.log10(TARGET[0][0])) return TARGET[0][1];
  for (let i = 1; i < TARGET.length; i++) {
    const [f1, d1] = TARGET[i];
    const [f0, d0] = TARGET[i - 1];
    if (x <= Math.log10(f1)) {
      const t = (x - Math.log10(f0)) / (Math.log10(f1) - Math.log10(f0));
      return d0 + (d1 - d0) * (0.5 - Math.cos(Math.PI * t) / 2);
    }
  }
  return TARGET[TARGET.length - 1][1];
}

/**
 * Bands that bring a voice (its long-term spectrum, relative dB) toward the
 * speech target: the two are lined up over the speech range, then each band
 * takes 80 % of the difference around it, at most ±6 dB.
 */
export function matchToTarget(voice: (f: number) => number): number[] {
  const freqs = Array.from({ length: 240 }, (_, i) => 20 * 1000 ** (i / 239));
  const speech = freqs.filter((f) => f >= 150 && f <= 6000);
  const offset = speech.reduce((s, f) => s + speechTarget(f) - voice(f), 0) / speech.length;
  return BANDS.map((fc) => {
    const around = freqs.filter((f) => f >= fc / 1.41 && f <= fc * 1.41);
    const diff = around.reduce((s, f) => s + speechTarget(f) - voice(f) - offset, 0) / around.length;
    const g = Math.max(-6, Math.min(6, Math.round(diff * 0.8)));
    return g === 0 ? 0 : g; // no −0
  });
}

/** The EQ and compressor for one track, streaming interleaved chunks. */
export class ToneProcessor {
  private channels: number;
  private eq: { c: [number, number, number, number, number]; z: Float64Array }[] = [];
  private comp: CompSettings | null;
  private att: number;
  private rel: number;
  private gr = 0;
  private env = 0;
  private envRel: number;
  private makeup: number;

  constructor(rate: number, channels: number, tone: VoiceTone) {
    this.channels = channels;
    if (tone.eq.on)
      tone.eq.gains.forEach((g, i) => {
        if (g && usable(BANDS[i], rate)) this.eq.push({ c: peaking(BANDS[i], g, rate), z: new Float64Array(4 * channels) });
      });
    this.comp = tone.comp.on ? tone.comp : null;
    this.att = Math.exp(-1 / (0.01 * rate));
    this.rel = Math.exp(-1 / (0.15 * rate));
    this.envRel = Math.exp(-1 / (0.05 * rate));
    this.makeup = tone.comp.on ? 10 ** (tone.comp.makeup / 20) : 1;
  }

  /** Processes `x` in place and returns it. */
  process(x: Float32Array): Float32Array {
    const ch = this.channels;
    for (const { c, z } of this.eq) {
      const [b0, b1, b2, a1, a2] = c;
      for (let k = 0; k < ch; k++) {
        let x1 = z[4 * k], x2 = z[4 * k + 1], y1 = z[4 * k + 2], y2 = z[4 * k + 3];
        for (let i = k; i < x.length; i += ch) {
          const v = x[i];
          const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
          x2 = x1;
          x1 = v;
          y2 = y1;
          y1 = y;
          x[i] = y;
        }
        z[4 * k] = x1;
        z[4 * k + 1] = x2;
        z[4 * k + 2] = y1;
        z[4 * k + 3] = y2;
      }
    }
    const c = this.comp;
    if (c) {
      for (let i = 0; i < x.length; i += ch) {
        let peak = 0;
        for (let k = 0; k < ch; k++) peak = Math.max(peak, Math.abs(x[i + k]));
        this.env = peak > this.env ? peak : this.env * this.envRel;
        const level = this.env > 1e-9 ? 20 * Math.log10(this.env) : -180;
        const want = compCurve(level, c) - level; // ≤ 0
        this.gr = want < this.gr ? this.att * this.gr + (1 - this.att) * want : this.rel * this.gr + (1 - this.rel) * want;
        const g = 10 ** (this.gr / 20) * this.makeup;
        for (let k = 0; k < ch; k++) x[i + k] *= g;
      }
    }
    return x;
  }
}
