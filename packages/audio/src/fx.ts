// Per-track FX (Stage 05): noise reduction → high-pass → low-pass → 3-band EQ → compressor.
// One deterministic implementation shared by the export (worker render) and the browser preview
// (an AudioWorklet runs this same module), so preview and export process audio identically.
//
// Algorithm record (PREBUILD's DSP decision, made here):
// - FX_VERSION 1. Order: NR → HPF → LPF → EQ (low shelf, mid bell, high shelf) → compressor.
//   Applied per track after clip gain/fades and ducking, before the fader and pan.
// - Constant latency FX_LATENCY frames on every track that goes through FX (the NR's STFT frame;
//   a plain delay line when NR is off), so tracks stay aligned; the render drops it, the preview
//   schedules audio that much early.
// - Noise reduction: STFT, N = 1024, hop 256, √Hann analysis/synthesis (Hann² overlap-add = 2 →
//   ×½). Per bin: time-smoothed power, minimum-statistics noise floor (falls to any lower value
//   at once, rises ≈ +3 dB/s; seeded from the first frame) × bias 6, power spectral subtraction
//   (β = 3) → amplitude gain (smoothing 0.9 on the per-bin power), floor
//   Gmin = 10^(−20·amount/20) (amount 0…1 → 0…20 dB maximum reduction), gains fall slowly
//   (0.6/0.4 smoothing) and are averaged over 3 bins against musical noise.
// - Filters: RBJ biquads, transposed direct form II, 64-bit state. HPF/LPF Butterworth Q = 1/√2
//   (12 dB/oct). Low shelf / high shelf slope 1, mid bell Q = 1.
// - Compressor: stereo-linked peak detector (5 ms attack, 120 ms release) in dB, soft knee 6 dB.
//   amount a ∈ 0…1 → threshold −10 − 20a dBFS, ratio 1.5 + 4.5a, make-up ½·|thr|·(1 − 1/ratio).
// Every stage is sample-accurate, so the output doesn't depend on how audio is split into blocks.

export const FX_VERSION = 1;
export const FX_LATENCY = 1024;

export const FX_RANGES = {
  nrAmount: { min: 0, max: 1 },
  hpf: { min: 20, max: 300 },
  lpf: { min: 4000, max: 20000 },
  eqGain: { min: -12, max: 12 },
  low: { min: 60, max: 400 },
  mid: { min: 300, max: 6000 },
  high: { min: 4000, max: 16000 },
  compAmount: { min: 0, max: 1 },
} as const;

export interface EqBand {
  gainDb: number;
  freq: number;
}

export interface TrackFx {
  v: typeof FX_VERSION;
  /** Master switch for the track's FX (off = bypass, for A/B listening). */
  on: boolean;
  nr: { on: boolean; amount: number };
  hpf: { on: boolean; freq: number };
  lpf: { on: boolean; freq: number };
  eq: { low: EqBand; mid: EqBand; high: EqBand };
  comp: { on: boolean; amount: number };
}

export const defaultFx = (): TrackFx => ({
  v: FX_VERSION,
  on: true,
  nr: { on: false, amount: 0.5 },
  hpf: { on: false, freq: 80 },
  lpf: { on: false, freq: 16000 },
  eq: { low: { gainDb: 0, freq: 120 }, mid: { gainDb: 0, freq: 2500 }, high: { gainDb: 0, freq: 8000 } },
  comp: { on: false, amount: 0.4 },
});

/** Does this FX setting change the sound at all? (Bypassed, or nothing switched on and EQ flat.) */
export function fxActive(fx: TrackFx | undefined): boolean {
  if (!fx || !fx.on) return false;
  return fx.nr.on || fx.hpf.on || fx.lpf.on || fx.comp.on || fx.eq.low.gainDb !== 0 || fx.eq.mid.gainDb !== 0 || fx.eq.high.gainDb !== 0;
}

const clamp = (v: unknown, r: { min: number; max: number }, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(r.min, Math.min(r.max, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

/** Clean copy of untrusted FX settings (values clamped into range, never wrapped). Null if it isn't an FX object. */
export function normalizeFx(raw: unknown): TrackFx | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  if (r.v !== FX_VERSION) return null;
  const d = defaultFx();
  const band = (b: any, f: { min: number; max: number }, def: EqBand): EqBand => ({ gainDb: clamp(b?.gainDb, FX_RANGES.eqGain, def.gainDb), freq: clamp(b?.freq, f, def.freq) });
  return {
    v: FX_VERSION,
    on: bool(r.on, d.on),
    nr: { on: bool(r.nr?.on, d.nr.on), amount: clamp(r.nr?.amount, FX_RANGES.nrAmount, d.nr.amount) },
    hpf: { on: bool(r.hpf?.on, d.hpf.on), freq: clamp(r.hpf?.freq, FX_RANGES.hpf, d.hpf.freq) },
    lpf: { on: bool(r.lpf?.on, d.lpf.on), freq: clamp(r.lpf?.freq, FX_RANGES.lpf, d.lpf.freq) },
    eq: { low: band(r.eq?.low, FX_RANGES.low, d.eq.low), mid: band(r.eq?.mid, FX_RANGES.mid, d.eq.mid), high: band(r.eq?.high, FX_RANGES.high, d.eq.high) },
    comp: { on: bool(r.comp?.on, d.comp.on), amount: clamp(r.comp?.amount, FX_RANGES.compAmount, d.comp.amount) },
  };
}

/** The compressor's real parameters for a percentage (documented mapping). */
export function compParams(amount: number) {
  const a = Math.max(0, Math.min(1, amount));
  const thresholdDb = -10 - 20 * a;
  const ratio = 1.5 + 4.5 * a;
  return { thresholdDb, ratio, kneeDb: 6, attackMs: 5, releaseMs: 120, makeupDb: 0.5 * Math.abs(thresholdDb) * (1 - 1 / ratio) };
}

// ---- biquads -----------------------------------------------------------------------------------

export interface Coefs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}
const IDENTITY: Coefs = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

/** RBJ cookbook coefficients. */
export function biquad(type: "hpf" | "lpf" | "lowshelf" | "peak" | "highshelf", f: number, rate: number, gainDb = 0, q = Math.SQRT1_2): Coefs {
  const w0 = (2 * Math.PI * Math.min(f, rate * 0.49)) / rate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (type === "hpf" || type === "lpf") {
    const alpha = sin / (2 * q);
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
    if (type === "lpf") {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    }
  } else if (type === "peak") {
    const alpha = sin / (2 * q);
    b0 = 1 + alpha * A;
    b1 = -2 * cos;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cos;
    a2 = 1 - alpha / A;
  } else {
    // shelves, slope S = 1
    const alpha = (sin / 2) * Math.SQRT2;
    const sq = 2 * Math.sqrt(A) * alpha;
    if (type === "lowshelf") {
      b0 = A * (A + 1 - (A - 1) * cos + sq);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - sq);
      a0 = A + 1 + (A - 1) * cos + sq;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - sq;
    } else {
      b0 = A * (A + 1 + (A - 1) * cos + sq);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - sq);
      a0 = A + 1 - (A - 1) * cos + sq;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - sq;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Magnitude (dB) of a biquad at frequency f. */
export function biquadDb(c: Coefs, f: number, rate: number): number {
  const w = (2 * Math.PI * f) / rate;
  const cr = Math.cos(w), ci = -Math.sin(w), c2r = Math.cos(2 * w), c2i = -Math.sin(2 * w);
  const nr = c.b0 + c.b1 * cr + c.b2 * c2r, ni = c.b1 * ci + c.b2 * c2i;
  const dr = 1 + c.a1 * cr + c.a2 * c2r, di = c.a1 * ci + c.a2 * c2i;
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** The filter + EQ stages for a setting (the EQ curve the UI draws uses exactly these). */
export function fxBiquads(fx: TrackFx, rate: number): Coefs[] {
  const out: Coefs[] = [];
  if (fx.hpf.on) out.push(biquad("hpf", fx.hpf.freq, rate));
  if (fx.lpf.on) out.push(biquad("lpf", fx.lpf.freq, rate));
  if (fx.eq.low.gainDb !== 0) out.push(biquad("lowshelf", fx.eq.low.freq, rate, fx.eq.low.gainDb));
  if (fx.eq.mid.gainDb !== 0) out.push(biquad("peak", fx.eq.mid.freq, rate, fx.eq.mid.gainDb, 1));
  if (fx.eq.high.gainDb !== 0) out.push(biquad("highshelf", fx.eq.high.freq, rate, fx.eq.high.gainDb));
  return out;
}

/** The filters + EQ magnitude response (dB) at frequency f. */
export function fxCurveDb(fx: TrackFx, f: number, rate = 48000): number {
  if (!fx.on) return 0;
  return fxBiquads(fx, rate).reduce((s, c) => s + biquadDb(c, f, rate), 0);
}

// ---- FFT (radix-2, in place) -------------------------------------------------------------------

class FFT {
  private rev: Uint32Array;
  private cos: Float64Array;
  private sin: Float64Array;
  constructor(readonly n: number) {
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
  }
  /** In-place transform; inverse = true for the unscaled inverse. */
  run(re: Float64Array, im: Float64Array, inverse: boolean) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i]!;
      if (j > i) {
        let t = re[i]!;
        re[i] = re[j]!;
        re[j] = t;
        t = im[i]!;
        im[i] = im[j]!;
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step]!;
          const wi = inverse ? this.sin[k * step]! : -this.sin[k * step]!;
          const a = i + k;
          const b = a + half;
          const xr = re[b]! * wr - im[b]! * wi;
          const xi = re[b]! * wi + im[b]! * wr;
          re[b] = re[a]! - xr;
          im[b] = im[a]! - xi;
          re[a] = re[a]! + xr;
          im[a] = im[a]! + xi;
        }
      }
    }
  }
}

// ---- noise reduction (one channel; also the fixed-latency delay when off) ------------------------

const NR_N = FX_LATENCY;
const NR_HOP = 256;
const NR_BINS = NR_N / 2 + 1;
/** Tuning (exported only so the tests can sweep it): power smoothing, minimum-statistics bias, over-subtraction. */
export const NR_TUNING = { smooth: 0.9, bias: 6, beta: 3 };

class NoiseReducer {
  private fft = new FFT(NR_N);
  private win = new Float64Array(NR_N);
  private inBuf = new Float64Array(NR_N); // the last N input samples
  private outAcc = new Float64Array(NR_N); // overlap-add accumulator
  private fill = 0; // samples since the last frame
  private re = new Float64Array(NR_N);
  private im = new Float64Array(NR_N);
  private pSmooth = new Float64Array(NR_BINS);
  private noise = new Float64Array(NR_BINS).fill(Number.POSITIVE_INFINITY);
  private gPrev = new Float64Array(NR_BINS).fill(1);
  private gRaw = new Float64Array(NR_BINS);
  private frames = 0;
  private rise: number;
  // the output stream: one hop of finished samples is handed out at a time
  private ready = new Float64Array(NR_HOP);
  private readyPos = NR_HOP;
  /** Pure delay mode (NR off): an exact FX_LATENCY-sample delay line. */
  private delay = new Float64Array(NR_N);
  private delayPos = 0;
  on = false;
  floor = 1;

  constructor(rate: number) {
    for (let i = 0; i < NR_N; i++) this.win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / NR_N)); // √(periodic Hann)
    // noise floor may rise ≈ 3 dB per second
    this.rise = Math.pow(10, (3 / 10) * (NR_HOP / rate));
    // prime the overlap-add so the STFT path has exactly FX_LATENCY samples of delay
    this.readyPos = NR_HOP;
  }

  process(x: Float32Array, out: Float32Array) {
    if (!this.on) {
      // exact delay line
      const d = this.delay;
      let p = this.delayPos;
      for (let i = 0; i < x.length; i++) {
        out[i] = d[p]!;
        d[p] = x[i]!;
        p = p + 1 === NR_N ? 0 : p + 1;
      }
      this.delayPos = p;
      return;
    }
    for (let i = 0; i < x.length; i++) {
      // shift the sample in
      this.inBuf.copyWithin(0, 1);
      this.inBuf[NR_N - 1] = x[i]!;
      if (this.readyPos === NR_HOP) this.readyPos = 0;
      out[i] = this.ready[this.readyPos++]!;
      if (++this.fill === NR_HOP) {
        this.fill = 0;
        this.frame();
      }
    }
  }

  private frame() {
    const { re, im, win } = this;
    for (let i = 0; i < NR_N; i++) {
      re[i] = this.inBuf[i]! * win[i]!;
      im[i] = 0;
    }
    this.fft.run(re, im, false);
    const floor = this.floor;
    for (let k = 0; k < NR_BINS; k++) {
      const p = re[k]! * re[k]! + im[k]! * im[k]!;
      // seed the smoothing with the first frame; ramping up from 0 would plant a far-too-low noise floor
      const a = this.frames === 0 ? 0 : NR_TUNING.smooth;
      const ps = (this.pSmooth[k] = a * this.pSmooth[k]! + (1 - a) * p);
      let nz = this.noise[k]!;
      nz = ps < nz ? ps : nz * this.rise;
      this.noise[k] = nz;
      // the minimum of a smoothed periodogram sits below the noise mean: scale it back up (bias), then subtract (beta)
      const sub = 1 - (NR_TUNING.beta * NR_TUNING.bias * nz) / Math.max(ps, 1e-20);
      let g = Math.sqrt(Math.max(0, sub));
      if (g < floor) g = floor;
      const prev = this.gPrev[k]!;
      if (g < prev) g = 0.6 * prev + 0.4 * g; // fall slowly
      this.gRaw[k] = g;
    }
    for (let k = 0; k < NR_BINS; k++) {
      const a = this.gRaw[k > 0 ? k - 1 : k]!;
      const c = this.gRaw[k < NR_BINS - 1 ? k + 1 : k]!;
      const g = (a + this.gRaw[k]! + c) / 3;
      this.gPrev[k] = this.gRaw[k]!;
      re[k] = re[k]! * g;
      im[k] = im[k]! * g;
      if (k > 0 && k < NR_N / 2) {
        re[NR_N - k] = re[k]!;
        im[NR_N - k] = -im[k]!;
      }
    }
    this.frames++;
    this.fft.run(re, im, true);
    // overlap-add: √Hann × √Hann = Hann; four Hanns at hop N/4 sum to 2, and the inverse FFT is unscaled (×N)
    const scale = 1 / (NR_N * 2);
    const acc = this.outAcc;
    for (let i = 0; i < NR_N; i++) acc[i] = acc[i]! + re[i]! * win[i]! * scale;
    // the first hop is now complete
    this.ready.set(acc.subarray(0, NR_HOP));
    acc.copyWithin(0, NR_HOP);
    acc.fill(0, NR_N - NR_HOP);
  }
}

// ---- biquad runner -----------------------------------------------------------------------------

class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(public c: Coefs) {}
  run(x: Float32Array) {
    const { b0, b1, b2, a1, a2 } = this.c;
    let z1 = this.z1, z2 = this.z2;
    for (let i = 0; i < x.length; i++) {
      const v = x[i]!;
      const y = b0 * v + z1;
      z1 = b1 * v - a1 * y + z2;
      z2 = b2 * v - a2 * y;
      x[i] = y;
    }
    this.z1 = z1;
    this.z2 = z2;
  }
}

// ---- the chain ---------------------------------------------------------------------------------

/**
 * A track's FX, streaming, for 1 or 2 channels. Output is delayed by exactly FX_LATENCY samples.
 * Feed blocks of any size; results don't depend on how the stream is cut into blocks.
 */
export class FxChain {
  private nr: NoiseReducer[];
  private eqs: Biquad[][] = [];
  private fx: TrackFx = defaultFx();
  private sig = "";
  // compressor
  private env = 0; // detector level (linear)
  private atk: number;
  private rel: number;
  private comp = compParams(0);
  private makeup = 1;
  /** Deepest gain reduction (dB, ≤ 0) since the last read. */
  private grMin = 0;
  private tmp: Float32Array[] = [];

  constructor(readonly rate: number, readonly channels: number, fx?: TrackFx) {
    this.nr = Array.from({ length: channels }, () => new NoiseReducer(rate));
    this.atk = 1 - Math.exp(-1 / (0.005 * rate));
    this.rel = 1 - Math.exp(-1 / (0.12 * rate));
    this.set(fx ?? defaultFx());
  }

  /** Change the settings; filter state carries over (no clicks from resetting). */
  set(fx: TrackFx) {
    this.fx = fx;
    const on = fx.on;
    for (const n of this.nr) {
      n.on = on && fx.nr.on;
      n.floor = Math.pow(10, (-20 * (on ? fx.nr.amount : 0)) / 20);
    }
    const coefs = on ? fxBiquads(fx, this.rate) : [];
    const sig = coefs.map((c) => `${c.b0},${c.b1},${c.b2},${c.a1},${c.a2}`).join("|");
    if (sig !== this.sig) {
      // keep existing filter states where the stage count is unchanged; new stages start at rest
      this.eqs = Array.from({ length: this.channels }, (_, ch) => coefs.map((c, i) => {
        const old = this.eqs[ch]?.[i];
        if (old) {
          old.c = c;
          return old;
        }
        return new Biquad(c);
      }));
      this.sig = sig;
    }
    this.comp = compParams(fx.comp.amount);
    this.makeup = Math.pow(10, this.comp.makeupDb / 20);
  }

  /** Gain reduction (dB, ≤ 0) since the last call — for the meter. */
  takeGainReduction(): number {
    const g = this.grMin;
    this.grMin = 0;
    return g;
  }

  /** Process one block (one array per channel, same length); returns new arrays. */
  process(input: Float32Array[]): Float32Array[] {
    const n = input[0]!.length;
    const out = Array.from({ length: this.channels }, (_, c) => {
      const o = new Float32Array(n);
      this.nr[c]!.process(input[Math.min(c, input.length - 1)]!, o);
      return o;
    });
    for (let c = 0; c < this.channels; c++) for (const bq of this.eqs[c] ?? []) bq.run(out[c]!);
    if (this.fx.on && this.fx.comp.on) this.compress(out);
    return out;
  }

  private compress(chs: Float32Array[]) {
    const { thresholdDb, ratio, kneeDb } = this.comp;
    const slope = 1 / ratio - 1;
    const n = chs[0]!.length;
    let env = this.env;
    let grMin = this.grMin;
    for (let i = 0; i < n; i++) {
      let peak = 0;
      for (const c of chs) {
        const a = Math.abs(c[i]!);
        if (a > peak) peak = a;
      }
      env += (peak - env) * (peak > env ? this.atk : this.rel);
      const lvl = env > 1e-9 ? 20 * Math.log10(env) : -180;
      const over = lvl - thresholdDb;
      let gr = 0;
      if (over > kneeDb / 2) gr = slope * over;
      else if (over > -kneeDb / 2) gr = (slope * (over + kneeDb / 2) * (over + kneeDb / 2)) / (2 * kneeDb);
      if (gr < grMin) grMin = gr;
      const g = Math.pow(10, gr / 20) * this.makeup;
      for (const c of chs) c[i] = c[i]! * g;
    }
    this.env = env;
    this.grMin = grMin;
  }
}
