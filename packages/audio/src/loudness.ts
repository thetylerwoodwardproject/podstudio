// Loudness measurement per ITU-R BS.1770-4 / EBU R128 (integrated, momentary, short-term, LRA)
// and a 4× oversampled true-peak estimate, plus the true-peak limiter the export uses after
// normalising to the podcast target. Streaming: push blocks of any length, read values any time.
// Shared by the worker's export (normalisation) and the browser's master meter.

/** Podcast delivery targets: −19 LUFS for mono, −16 LUFS for stereo (the same perceived level), −1 dBTP ceiling. */
export const PODCAST_LOUDNESS = { mono: -19, stereo: -16, truePeakDb: -1 } as const;

export const lufsFrom = (meanSquare: number) => (meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) : Number.NEGATIVE_INFINITY);
const meanSquareFrom = (lufs: number) => Math.pow(10, (lufs + 0.691) / 10);

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * The two K-weighting stages (high shelf, then high pass) for any sample rate — the libebur128
 * derivation, which reproduces the BS.1770 48 kHz coefficients exactly.
 */
export function kWeighting(rate: number): [Biquad, Biquad] {
  // stage 1: high shelf, ~+4 dB above ~1.7 kHz (head acoustics)
  let shelf: Biquad;
  {
    const f0 = 1681.974450955533;
    const G = 3.999843853973347;
    const Q = 0.7071752369554196;
    const K = Math.tan((Math.PI * f0) / rate);
    const Vh = Math.pow(10, G / 20);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K;
    shelf = { b0: (Vh + (Vb * K) / Q + K * K) / a0, b1: (2 * (K * K - Vh)) / a0, b2: (Vh - (Vb * K) / Q + K * K) / a0, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  }
  // stage 2: high pass at ~38 Hz (RLB weighting)
  const f0 = 38.13547087602444;
  const Q = 0.5003270373238773;
  const K = Math.tan((Math.PI * f0) / rate);
  const a0 = 1 + K / Q + K * K;
  const hp: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, hp];
}

/** Integrated / momentary / short-term loudness and LRA of a stream (1 or 2 channels, weight 1 each). */
export class LoudnessMeter {
  private readonly f: [Biquad, Biquad];
  /** Filter state per channel: [x1, x2, y1, y2] for each stage. */
  private readonly st: Float64Array[];
  private readonly step: number;
  private acc = 0;
  private n = 0;
  /** Mean square (summed over channels) of each 100 ms sub-block. */
  private sub: number[] = [];

  constructor(readonly rate: number, readonly channels: number) {
    this.f = kWeighting(rate);
    this.st = Array.from({ length: channels }, () => new Float64Array(8));
    this.step = Math.round(rate / 10);
  }

  push(chs: Float32Array[]) {
    const len = chs[0]?.length ?? 0;
    const [s1, s2] = this.f;
    for (let i = 0; i < len; i++) {
      let e = 0;
      for (let c = 0; c < this.channels; c++) {
        const s = this.st[c]!;
        const x = chs[c]![i]!;
        const y1 = s1.b0 * x + s1.b1 * s[0]! + s1.b2 * s[1]! - s1.a1 * s[2]! - s1.a2 * s[3]!;
        s[1] = s[0]!;
        s[0] = x;
        s[3] = s[2]!;
        s[2] = y1;
        const y2 = s2.b0 * y1 + s2.b1 * s[4]! + s2.b2 * s[5]! - s2.a1 * s[6]! - s2.a2 * s[7]!;
        s[5] = s[4]!;
        s[4] = y1;
        s[7] = s[6]!;
        s[6] = y2;
        e += y2 * y2;
      }
      this.acc += e;
      if (++this.n === this.step) {
        this.sub.push(this.acc / this.step);
        this.acc = 0;
        this.n = 0;
      }
    }
  }

  private window(count: number): number {
    if (this.sub.length < count) return Number.NEGATIVE_INFINITY;
    let s = 0;
    for (let i = this.sub.length - count; i < this.sub.length; i++) s += this.sub[i]!;
    return lufsFrom(s / count);
  }

  /** Last 400 ms. */
  momentary() {
    return this.window(4);
  }

  /** Last 3 s. */
  shortTerm() {
    return this.window(30);
  }

  /** Gated integrated loudness over everything pushed so far (400 ms blocks, 75 % overlap, −70 LUFS absolute and −10 LU relative gates). */
  integrated(): number {
    const blocks: number[] = [];
    for (let j = 0; j + 4 <= this.sub.length; j++) blocks.push((this.sub[j]! + this.sub[j + 1]! + this.sub[j + 2]! + this.sub[j + 3]!) / 4);
    const abs = meanSquareFrom(-70);
    const pass1 = blocks.filter((z) => z > abs);
    if (pass1.length === 0) return Number.NEGATIVE_INFINITY;
    const rel = meanSquareFrom(lufsFrom(pass1.reduce((a, b) => a + b, 0) / pass1.length) - 10);
    const pass2 = pass1.filter((z) => z > rel);
    return lufsFrom(pass2.reduce((a, b) => a + b, 0) / pass2.length);
  }

  /** Loudness range (EBU Tech 3342): spread between the 10th and 95th percentile of gated 3 s short-term values. */
  lra(): number {
    const st: number[] = [];
    let s = 0;
    for (let i = 0; i < this.sub.length; i++) {
      s += this.sub[i]!;
      if (i >= 30) s -= this.sub[i - 30]!;
      if (i >= 29) st.push(s / 30);
    }
    const g1 = st.filter((z) => z > meanSquareFrom(-70));
    if (g1.length < 2) return 0;
    const rel = meanSquareFrom(lufsFrom(g1.reduce((a, b) => a + b, 0) / g1.length) - 20);
    const g2 = g1.filter((z) => z > rel).map(lufsFrom).sort((a, b) => a - b);
    if (g2.length < 2) return 0;
    const pct = (p: number) => g2[Math.min(g2.length - 1, Math.max(0, Math.round((p / 100) * (g2.length - 1))))]!;
    return pct(95) - pct(10);
  }

  reset() {
    this.sub = [];
    this.acc = 0;
    this.n = 0;
    for (const s of this.st) s.fill(0);
  }
}

// ---- true peak ---------------------------------------------------------------------------------

const OS = 4;
const HALF = 6; // taps each side per phase (12-tap phases, 48-tap prototype)
/** Polyphase interpolator: PHASES[k][m] weights x[n - HALF + 1 + m] for the point k/4 of the way from x[n] to x[n+1]. */
const PHASES: Float64Array[] = (() => {
  const out: Float64Array[] = [];
  for (let k = 1; k < OS; k++) {
    const frac = k / OS;
    const ph = new Float64Array(2 * HALF);
    let sum = 0;
    for (let m = 0; m < 2 * HALF; m++) {
      const d = m - (HALF - 1) - frac; // distance (in input samples) from the interpolated point
      const sinc = d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / (HALF + 0.5)); // Hann
      ph[m] = sinc * w;
      sum += ph[m]!;
    }
    for (let m = 0; m < 2 * HALF; m++) ph[m] = ph[m]! / sum;
    out.push(ph);
  }
  return out;
})();
/** Inter-sample peaks can't exceed the neighbouring samples by much more than this; below it, skip the filter. */
const NEAR = 0.5;

/** Largest absolute value between x[i] and x[i+1] (inclusive of x[i]), 4× oversampled. `x` must hold i−5 … i+6. */
function peakAround(x: ArrayLike<number>, i: number): number {
  let p = Math.abs(x[i]!);
  for (const ph of PHASES) {
    let v = 0;
    for (let m = 0; m < 2 * HALF; m++) v += ph[m]! * (x[i - HALF + 1 + m] ?? 0);
    const a = Math.abs(v);
    if (a > p) p = a;
  }
  return p;
}

/** Streaming true-peak (dBTP) of 1–2 channels. */
export class TruePeakMeter {
  private hist: Float32Array[];
  max = 0;
  constructor(readonly channels: number) {
    this.hist = Array.from({ length: channels }, () => new Float32Array(2 * HALF));
  }
  push(chs: Float32Array[]) {
    for (let c = 0; c < this.channels; c++) {
      const x = chs[c]!;
      const h = this.hist[c]!;
      // work on [history | block] so the filter can look both ways
      const buf = new Float32Array(h.length + x.length);
      buf.set(h);
      buf.set(x, h.length);
      for (let i = HALF - 1; i < buf.length - HALF; i++) {
        const a = Math.abs(buf[i]!);
        if (a > this.max) this.max = a;
        // an inter-sample peak can only beat the current max near loud samples
        if (Math.max(a, Math.abs(buf[i + 1]!)) < this.max * NEAR) continue;
        const pk = peakAround(buf, i);
        if (pk > this.max) this.max = pk;
      }
      h.set(buf.subarray(buf.length - h.length));
    }
  }
  /** dBTP so far (−∞ for silence). */
  db() {
    return this.max > 0 ? 20 * Math.log10(this.max) : Number.NEGATIVE_INFINITY;
  }
}

// ---- true-peak limiter -----------------------------------------------------------------------

/**
 * Lookahead brick-wall limiter on the 4×-oversampled peak, channels linked. The gain needed at each
 * sample is held for the lookahead and averaged over it (so it is fully down by the time the peak
 * arrives, with no step), then released smoothly. Output is delayed by `latency` samples; call
 * `flush()` at the end for the tail. Stays transparent (gain 1) wherever nothing is near the ceiling.
 */
export class TruePeakLimiter {
  readonly latency: number;
  private readonly L: number;
  private readonly ceil: number;
  private readonly rel: number;
  private readonly cap: number;
  /** Ring of input samples per channel (for the delay and the peak filter). */
  private ring: Float32Array[];
  private w = 0; // samples written
  // gain-requirement pipeline
  private greq: Float32Array; // ring of required gain per sample
  private dq: Int32Array; // monotonic deque (indices) for the sliding minimum
  private dqHead = 0;
  private dqTail = 0;
  private box: Float32Array; // the last L sliding minimums, for the box average
  private boxSum = 0;
  private r = 1;
  /** Samples whose gain went below 1. */
  limited = 0;
  /** Lowest gain applied. */
  minGain = 1;

  constructor(readonly rate: number, readonly channels: number, ceilingDb: number, lookaheadMs = 5, releaseMs = 80) {
    this.L = Math.max(2, Math.round((lookaheadMs / 1000) * rate));
    this.latency = HALF + this.L - 1;
    this.ceil = Math.pow(10, ceilingDb / 20);
    this.rel = 1 - Math.exp(-1 / ((releaseMs / 1000) * rate));
    this.cap = 1 << Math.ceil(Math.log2(this.L * 2 + 4 * HALF + 16));
    this.ring = Array.from({ length: channels }, () => new Float32Array(this.cap));
    this.greq = new Float32Array(this.cap);
    this.dq = new Int32Array(this.cap);
    this.box = new Float32Array(this.L).fill(1);
    this.boxSum = this.L; // L minimums of 1
  }

  private at(c: number, i: number) {
    return i < 0 ? 0 : this.ring[c]![i & (this.cap - 1)]!;
  }

  /** Feed samples; returns the same number of (delayed) output samples. */
  process(chs: Float32Array[]): Float32Array[] {
    const n = chs[0]!.length;
    const out = chs.map(() => new Float32Array(n));
    const mask = this.cap - 1;
    const near = this.ceil * NEAR;
    const tmp = new Float64Array(2 * HALF + 2);
    for (let i = 0; i < n; i++) {
      const idx = this.w++;
      for (let c = 0; c < this.channels; c++) this.ring[c]![idx & mask] = chs[c]![i]!;
      // 1. the peak around sample p = idx − HALF is now computable (needs up to p + HALF)
      const p = idx - HALF;
      if (p >= 0) {
        let peak = 0;
        for (let c = 0; c < this.channels; c++) {
          const a = Math.abs(this.at(c, p));
          const b = Math.abs(this.at(c, p + 1));
          let pk = a;
          if (Math.max(a, b) > near) {
            for (let m = 0; m < tmp.length; m++) tmp[m] = this.at(c, p - HALF + m);
            pk = peakAround(tmp, HALF);
          }
          if (pk > peak) peak = pk;
        }
        const g = peak > this.ceil ? this.ceil / peak : 1;
        this.greq[p & mask] = g;
        // 2. sliding minimum over [k, k + L − 1], available for k = p − L + 1
        while (this.dqTail > this.dqHead && this.greq[this.dq[(this.dqTail - 1) & mask]! & mask]! >= g) this.dqTail--;
        this.dq[this.dqTail++ & mask] = p;
        const k = p - this.L + 1;
        while (this.dq[this.dqHead & mask]! < k) this.dqHead++;
        if (k >= 0) {
          const m = this.greq[this.dq[this.dqHead & mask]! & mask]!;
          // 3. box average of the last L minimums, then release smoothing (never above the box value)
          const slot = k % this.L; // holds the minimum from k − L, which leaves the window now
          this.boxSum += m - this.box[slot]!;
          this.box[slot] = m;
          if (slot === 0 && (k / this.L) % 4096 === 0) {
            // recompute now and then so float rounding can't drift over a 2-hour render
            let t = 0;
            for (let j = 0; j < this.L; j++) t += this.box[j]!;
            this.boxSum = t;
          }
          const s = Math.min(1, this.boxSum / this.L);
          const up = this.r + (1 - this.r) * this.rel;
          this.r = Math.min(s, up);
          if (this.r < 0.99885) {
            // more than 0.01 dB of reduction counts as limiting (the release tail below that is inaudible)
            this.limited++;
            if (this.r < this.minGain) this.minGain = this.r;
          }
          for (let c = 0; c < this.channels; c++) out[c]![i] = this.at(c, k) * this.r;
          continue;
        }
      }
      for (let c = 0; c < this.channels; c++) out[c]![i] = 0; // still filling the delay
    }
    return out;
  }

  /** The last `latency` samples (feeds silence through). */
  flush(): Float32Array[] {
    return this.process(Array.from({ length: this.channels }, () => new Float32Array(this.latency)));
  }
}
