/*
 * Loudness for the ready-to-publish export:
 *
 *   LoudnessMeter    integrated loudness, ITU-R BS.1770-4 / EBU R128 (LUFS):
 *                    K-weighting, 400 ms blocks every 100 ms, the −70 LUFS
 *                    absolute gate and the −10 LU relative gate.
 *   TruePeakLimiter  keeps the mix under a true-peak ceiling (−1 dBTP), with
 *                    peaks between samples found at 4× oversampling, a 5 ms
 *                    lookahead and a smooth release, so MP3/AAC encoding
 *                    doesn't clip.
 *   Leveler          evens out one speaker: a slow, gated gain rider toward
 *                    a speech level (±12 dB at most), then a gentle compressor
 *                    for laughs and plosives. The gain holds through pauses
 *                    and relaxes after 10 s of quiet; room noise alone is
 *                    never pushed up.
 *
 * All three take interleaved float chunks and keep their state between calls,
 * so a whole episode streams through in pieces with the same result as one go.
 */

const db = (x: number) => 10 * Math.log10(x);
const fromDb = (d: number) => 10 ** (d / 20);

/** One biquad per channel, direct form I. */
class Biquad {
  private b: [number, number, number];
  private a: [number, number];
  private x1: Float64Array;
  private x2: Float64Array;
  private y1: Float64Array;
  private y2: Float64Array;
  constructor(b: [number, number, number], a: [number, number], channels: number) {
    this.b = b;
    this.a = a;
    this.x1 = new Float64Array(channels);
    this.x2 = new Float64Array(channels);
    this.y1 = new Float64Array(channels);
    this.y2 = new Float64Array(channels);
  }
  step(x: number, c: number) {
    const [b0, b1, b2] = this.b;
    const [a1, a2] = this.a;
    const y = b0 * x + b1 * this.x1[c] + b2 * this.x2[c] - a1 * this.y1[c] - a2 * this.y2[c];
    this.x2[c] = this.x1[c];
    this.x1[c] = x;
    this.y2[c] = this.y1[c];
    this.y1[c] = y;
    return y;
  }
}

/** BS.1770 K-weighting (a high shelf, then a high pass) for any sample rate. */
function kWeighting(rate: number, channels: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / rate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = new Biquad(
    [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
    channels,
  );
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / rate);
  a0 = 1 + K / Q + K * K;
  const highpass = new Biquad([1, -2, 1], [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0], channels);
  return [shelf, highpass];
}

export class LoudnessMeter {
  private channels: number;
  private filters: [Biquad, Biquad];
  private sub = 0;
  private subLen: number;
  private subCount = 0;
  private subs: number[] = [];
  /** Mean-square energy of each 400 ms block */
  private blocks: number[] = [];

  constructor(rate: number, channels: number) {
    this.channels = channels;
    this.filters = kWeighting(rate, channels);
    this.subLen = Math.round(rate * 0.1);
  }

  /** Interleaved samples. */
  push(x: Float32Array) {
    const ch = this.channels;
    const [s, h] = this.filters;
    for (let i = 0; i < x.length; i += ch) {
      for (let c = 0; c < ch; c++) {
        const z = h.step(s.step(x[i + c], c), c);
        this.sub += z * z; // channel weights are 1.0 for mono, L and R
      }
      if (++this.subCount === this.subLen) {
        this.subs.push(this.sub);
        this.sub = 0;
        this.subCount = 0;
        if (this.subs.length >= 4) {
          const n = this.subs.length;
          this.blocks.push((this.subs[n - 1] + this.subs[n - 2] + this.subs[n - 3] + this.subs[n - 4]) / (4 * this.subLen));
        }
      }
    }
  }

  /** Integrated loudness in LUFS (−Infinity for silence). */
  integrated(): number {
    const loud = (e: number) => -0.691 + db(e);
    const abs = this.blocks.filter((e) => loud(e) > -70);
    if (!abs.length) return -Infinity;
    const rel = loud(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
    const gated = abs.filter((e) => loud(e) > rel);
    return loud(gated.reduce((a, b) => a + b, 0) / gated.length);
  }

  /** Momentary loudness (the last 400 ms) every 100 ms, LUFS; the first is at 400 ms. */
  momentary(): number[] {
    return this.blocks.map((e) => -0.691 + db(e));
  }

  /** Short-term loudness (the last 3 s) every `step` seconds, for a loudness-over-time graph; −Infinity until 3 s in. */
  shortTerm(step = 1): number[] {
    const every = Math.max(1, Math.round(step * 10));
    const out: number[] = [];
    for (let i = every - 1; i < this.subs.length; i += every) out.push(this.shortAt(i));
    return out;
  }

  private shortAt(i: number) {
    if (i < 29) return -Infinity;
    let e = 0;
    for (let k = i - 29; k <= i; k++) e += this.subs[k];
    return -0.691 + db(e / (30 * this.subLen));
  }

  /**
   * Loudness range (EBU Tech 3342), in LU: the spread of short-term loudness
   * between its 10th and 95th percentiles, ignoring silence (−70 LUFS) and
   * anything 20 LU under the average. null if there isn't enough to measure.
   */
  range(): number | null {
    const st: number[] = [];
    for (let i = 29; i < this.subs.length; i++) st.push(this.shortAt(i));
    const abs = st.filter((x) => x > -70);
    if (abs.length < 10) return null;
    const rel = db(abs.reduce((a, x) => a + 10 ** (x / 10), 0) / abs.length) - 20;
    const g = abs.filter((x) => x > rel).sort((a, b) => a - b);
    const at = (p: number) => g[Math.min(g.length - 1, Math.max(0, Math.round(p * (g.length - 1))))];
    return at(0.95) - at(0.1);
  }
}

/** 4× interpolation: 3 in-between values per sample from a windowed-sinc FIR (16 taps per phase). */
const PHASES = 4;
const TAPS = 16;
const interp: Float64Array[] = Array.from({ length: PHASES - 1 }, (_, p) => {
  const frac = (p + 1) / PHASES;
  const h = new Float64Array(TAPS);
  for (let k = 0; k < TAPS; k++) {
    const t = k - (TAPS / 2 - 1) - frac; // taps around the point between sample TAPS/2−1 and TAPS/2
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const w = 0.5 + 0.5 * Math.cos((Math.PI * t) / (TAPS / 2));
    h[k] = sinc * w;
  }
  return h;
});

/** Highest true (4× oversampled) peak of interleaved audio, linear. */
export function truePeak(x: Float32Array, channels: number): number {
  let peak = 0;
  const frames = x.length / channels;
  for (let c = 0; c < channels; c++) {
    for (let f = 0; f < frames; f++) {
      peak = Math.max(peak, Math.abs(x[f * channels + c]));
      if (f < TAPS / 2 - 1 || f + TAPS / 2 >= frames) continue;
      for (const h of interp) {
        let y = 0;
        for (let k = 0; k < TAPS; k++) y += h[k] * x[(f - (TAPS / 2 - 1) + k) * channels + c];
        peak = Math.max(peak, Math.abs(y));
      }
    }
  }
  return peak;
}

export class TruePeakLimiter {
  private channels: number;
  private ceiling: number;
  /** Lookahead, frames: the output is this late, which flush() makes up */
  private la: number;
  private rel: number;
  private hist: Float32Array[];
  private delay: Float32Array;
  /** Window length for the needed gains (each covers the 16 frames of its detection window) */
  private win: number;
  /** Sliding minimum of needed gains: frame numbers and values, increasing values front to back */
  private qT: Float64Array;
  private qV: Float64Array;
  private qHead = 0;
  private qLen = 0;
  /** Held gains averaged into the output gain (shorter than the lookahead by the detection window) */
  private held: Float64Array;
  private r = 1;
  private sum: number;
  private n = 0;
  private dropped = 0;

  constructor(rate: number, channels: number, ceilingDb = -1) {
    this.channels = channels;
    // A little under the ceiling: 4× oversampling can still miss a peak by a fraction of a dB.
    this.ceiling = fromDb(ceilingDb - 0.3);
    this.la = Math.max(TAPS * 2, Math.round(rate * 0.005));
    this.rel = 1 - Math.exp(-1 / (0.15 * rate));
    // Each sample stored twice, TAPS apart, so the newest TAPS always sit side by side.
    this.hist = Array.from({ length: channels }, () => new Float32Array(TAPS * 2));
    this.delay = new Float32Array((this.la + 1) * channels);
    // One longer than the delay line, so the frame leaving it is always inside the window.
    this.win = this.la + 2;
    this.qT = new Float64Array(this.win + 1);
    this.qV = new Float64Array(this.win + 1);
    this.held = new Float64Array(this.la + 1 - TAPS).fill(1);
    this.sum = this.held.length;
  }

  /**
   * How far the newest 16 frames must come down: their sample peaks, and the
   * peaks between the middle two found by 4× interpolation.
   */
  private needFor(x: Float32Array, i: number) {
    let peak = 0;
    for (let c = 0; c < this.channels; c++) {
      const h = this.hist[c];
      const w = this.n % TAPS;
      h[w] = h[w + TAPS] = x[i + c];
      const o = w + 1; // the window, oldest first: h[o] … h[o + TAPS − 1]
      let sp = 0;
      for (let k = 0; k < TAPS; k++) sp = Math.max(sp, Math.abs(h[o + k]));
      peak = Math.max(peak, sp);
      // Peaks between samples don't come 6 dB above the samples around them: skip the maths well below the ceiling.
      if (sp < this.ceiling * 0.5) continue;
      for (const p of interp) {
        let y = 0;
        for (let k = 0; k < TAPS; k++) y += p[k] * h[o + k];
        peak = Math.max(peak, Math.abs(y));
      }
    }
    return peak > this.ceiling ? this.ceiling / peak : 1;
  }

  private stepFrame(x: Float32Array, i: number, out: Float32Array, o: number) {
    const L = this.la + 1;
    const slot = this.n % L;
    // Low enough for every frame still in the lookahead (a sliding-window minimum)...
    const v = this.needFor(x, i);
    const cap = this.qT.length;
    while (this.qLen && this.qV[(this.qHead + this.qLen - 1) % cap] >= v) this.qLen--;
    this.qT[(this.qHead + this.qLen) % cap] = this.n;
    this.qV[(this.qHead + this.qLen) % cap] = v;
    this.qLen++;
    while (this.qT[this.qHead] <= this.n - this.win) {
      this.qHead = (this.qHead + 1) % cap;
      this.qLen--;
    }
    const m = this.qV[this.qHead];
    this.r = Math.min(m, this.r + (1 - this.r) * this.rel);
    // ...then smoothed: an average of held gains, every one of them low enough for the frame leaving now.
    const hs = this.n % this.held.length;
    this.sum += this.r - this.held[hs];
    this.held[hs] = this.r;
    const g = this.sum / this.held.length;
    for (let c = 0; c < this.channels; c++) {
      out[o + c] = this.delay[slot * this.channels + c] * g;
      this.delay[slot * this.channels + c] = x[i + c];
    }
    this.n++;
  }

  /** Interleaved samples in; the same number out, once flush() has returned the last ones. */
  process(x: Float32Array): Float32Array {
    const ch = this.channels;
    const out = new Float32Array(x.length);
    for (let i = 0; i < x.length; i += ch) this.stepFrame(x, i, out, i);
    // The first frames out are the empty delay line: drop them so output lines up with input.
    const skip = Math.min(out.length / ch, this.la + 1 - this.dropped);
    if (skip <= 0) return out;
    this.dropped += skip;
    return out.subarray(skip * ch);
  }

  /** The last frames still in the lookahead. */
  flush(): Float32Array {
    return this.process(new Float32Array((this.la + 1) * this.channels));
  }
}

export interface LevelerOptions {
  /** Short-term speech level to steer toward, dBFS RMS */
  target?: number;
  /** Most gain up / down, dB */
  maxBoost?: number;
  maxCut?: number;
  /** Below this short-term level it's a pause or room noise: hold the gain */
  gate?: number;
}

export class Leveler {
  private channels: number;
  private env = 0;
  private gainDb = 0;
  private comp = 0;
  private envCoef: number;
  private upCoef: number;
  private downCoef: number;
  private idleCoef: number;
  /** Frames of quiet so far: the gain holds for 10 s, then relaxes */
  private quiet = 0;
  private holdFrames: number;
  private cAttack: number;
  private cRelease: number;
  private target: number;
  private maxBoost: number;
  private maxCut: number;
  private gate: number;

  constructor(rate: number, channels: number, o: LevelerOptions = {}) {
    this.channels = channels;
    this.target = o.target ?? -24; // a typical speech level: the loudness stage sets the final volume
    this.maxBoost = o.maxBoost ?? 12;
    this.maxCut = o.maxCut ?? 12;
    this.gate = o.gate ?? -50;
    const coef = (s: number) => 1 - Math.exp(-1 / (s * rate));
    this.envCoef = coef(0.4);
    this.downCoef = coef(1); // bringing a loud voice down: about a second
    this.upCoef = coef(3); // bringing a quiet voice up: slower, so a breath isn't pumped
    this.idleCoef = coef(8); // after a long quiet, drift gently back toward no change
    this.holdFrames = 10 * rate;
    this.cAttack = coef(0.01);
    this.cRelease = coef(0.15);
  }

  /** Frames since the start: the gain is worked out every 16, whatever the chunk sizes. */
  private k = 0;
  private g = 1;

  /** Interleaved samples in and out (the same gain on every channel). */
  process(x: Float32Array): Float32Array {
    const ch = this.channels;
    const out = new Float32Array(x.length);
    const thresh = fromDb(this.target + 12);
    const STEP = 16;
    for (let i = 0; i < x.length; i += ch) {
      let p = 0;
      for (let c = 0; c < ch; c++) p += x[i + c] * x[i + c];
      p /= ch;
      this.env += (p - this.env) * this.envCoef;
      // The slow gain rider: its gain moves over seconds, so every 16 frames is plenty.
      if (this.k++ % STEP === 0) {
        const level = db(this.env + 1e-20);
        if (level > this.gate) {
          this.quiet = 0;
          const want = Math.max(-this.maxCut, Math.min(this.maxBoost, this.target - level));
          const c = want < this.gainDb ? this.downCoef : this.upCoef;
          this.gainDb += (want - this.gainDb) * (1 - (1 - c) ** STEP);
        } else if ((this.quiet += STEP) > this.holdFrames) {
          // A pause holds the gain; a long quiet lets it relax, so room noise isn't left boosted.
          this.gainDb += (0 - this.gainDb) * (1 - (1 - this.idleCoef) ** STEP);
        }
        this.g = fromDb(this.gainDb);
      }
      // Then a gentle compressor (3:1 on peaks 12 dB over the target: speech peaks sit well above its average).
      let peak = 0;
      for (let c = 0; c < ch; c++) peak = Math.max(peak, Math.abs(x[i + c] * this.g));
      const reduce = peak > thresh ? 20 * Math.log10(peak / thresh) * (1 - 1 / 3) : 0;
      this.comp += (reduce - this.comp) * (reduce > this.comp ? this.cAttack : this.cRelease);
      const total = this.comp > 1e-4 ? this.g * fromDb(-this.comp) : this.g;
      for (let c = 0; c < ch; c++) out[i + c] = x[i + c] * total;
    }
    return out;
  }
}
