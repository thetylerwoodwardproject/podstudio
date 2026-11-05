// Per-track FX (Stage 05): high-pass → noise reduction → expander → low-pass → 3-band EQ → compressor.
// One deterministic implementation shared by the export (worker render) and the browser preview
// (an AudioWorklet runs this same module), so preview and export process audio identically.
//
// Algorithm record (PREBUILD's DSP decision, made here):
// - FX_VERSION 1. Order: HPF → NR → expander → LPF → EQ (low shelf, mid bell, high shelf) → compressor.
//   (Rumble and plosive thump out first, so nothing downstream reacts to them; noise reduction while the
//   signal is still clean and before any dynamics; the expander before the compressor so the compressor
//   can't lift the noise floor back up; subtractive EQ before the compressor.)
//   Applied per track after clip gain/fades and ducking, before the fader and pan.
// - Constant latency FX_LATENCY frames on every track that goes through FX (the NR's STFT frame;
//   a plain delay line when NR is off), so tracks stay aligned; the render drops it, the preview
//   schedules audio that much early.
// - Noise reduction: DeepFilterNet3 (see the DFN block below and packages/audio/dfn/README.md). The
//   The model runs at full strength and its per-bin gain is smoothed (time + frequency) before it is applied, so
//   the noise floor doesn't flutter; the knob sets the smoothed gain's floor, 0…100 % → 0…36 dB. Latency 3072.
// - Filters: RBJ biquads, transposed direct form II, 64-bit state. HPF/LPF Butterworth Q = 1/√2
//   (12 dB/oct). Low shelf / high shelf slope 1, mid bell Q = 1.
// - Downward expander (right after the noise reduction): 3:1 below the threshold, 6 dB soft knee, at most
//   `rangeDb` of reduction; opens in ~3 ms, closes after an 80 ms hold over ~150 ms. Its detector listens to the
//   high-passed input, which runs FX_LATENCY (64 ms) ahead of the output, so it opens before a word arrives.
// - Compressor: stereo-linked peak detector (5 ms attack, 120 ms release) in dB, soft knee 6 dB.
//   amount a ∈ 0…1 → threshold −10 − 20a dBFS, ratio 1.5 + 4.5a, make-up ½·|thr|·(1 − 1/ratio).
// Every stage is sample-accurate, so the output doesn't depend on how audio is split into blocks.

export const FX_VERSION = 1;
export const FX_LATENCY = 3072; // 1440 (DeepFilterNet's own delay) + the smoother's frame (1024) + hop batching, rounded up to 6 × 512

export const FX_RANGES = {
  nrAmount: { min: 0, max: 1 },
  hpf: { min: 20, max: 300 },
  lpf: { min: 4000, max: 20000 },
  eqGain: { min: -12, max: 12 },
  low: { min: 60, max: 400 },
  mid: { min: 300, max: 6000 },
  high: { min: 4000, max: 16000 },
  compAmount: { min: 0, max: 1 },
  expThreshold: { min: -70, max: -20 },
  expRange: { min: 3, max: 30 },
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
  /** Downward expander: turns what is below `thresholdDb` down by up to `rangeDb` (between words, under breaths). */
  exp: { on: boolean; thresholdDb: number; rangeDb: number };
  comp: { on: boolean; amount: number };
}

export const defaultFx = (): TrackFx => ({
  v: FX_VERSION,
  on: true,
  nr: { on: false, amount: 0.5 },
  hpf: { on: false, freq: 80 },
  lpf: { on: false, freq: 16000 },
  eq: { low: { gainDb: 0, freq: 120 }, mid: { gainDb: 0, freq: 2500 }, high: { gainDb: 0, freq: 8000 } },
  exp: { on: false, thresholdDb: -50, rangeDb: 12 },
  comp: { on: false, amount: 0.4 },
});

/** Does this FX setting change the sound at all? (Bypassed, or nothing switched on and EQ flat.) */
export function fxActive(fx: TrackFx | undefined): boolean {
  if (!fx || !fx.on) return false;
  return fx.nr.on || fx.hpf.on || fx.lpf.on || fx.exp.on || fx.comp.on || fx.eq.low.gainDb !== 0 || fx.eq.mid.gainDb !== 0 || fx.eq.high.gainDb !== 0;
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
    exp: { on: bool(r.exp?.on, d.exp.on), thresholdDb: clamp(r.exp?.thresholdDb, FX_RANGES.expThreshold, d.exp.thresholdDb), rangeDb: clamp(r.exp?.rangeDb, FX_RANGES.expRange, d.exp.rangeDb) },
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

// ---- noise reduction (one channel; also the fixed-latency delay when off) ------------------------
//
// DeepFilterNet3 (packages/audio/dfn), run frame by frame: 480-sample hops at 48 kHz, 1440 samples of
// inherent delay. The wasm is supplied from outside (the browser's AudioWorklet gets it from the page,
// the export worker reads it from disk): setDfnRuntime(). Until it is supplied — or whenever the rate
// isn't 48 kHz, or the amount is 0 — the stage is the exact same-length delay, i.e. dry audio.
// The wet signal is played FX_LATENCY late and starts after a warm-up, so switching on, off or loading
// the model mid-stream never moves audio in time and block sizes never change the output.

export const DFN_HOP = 480;
export const DFN_RATE = 48_000;
/** Maximum reduction (dB) at amount = 1: DeepFilterNet's attenuation limit. */
export const DFN_MAX_DB = 36;
/** The knob → the noise reduction's maximum cut (dB): 0…100 % → 0…36 dB, linear. */
export function nrLimitDb(amount: number): number {
  const a = Math.max(0, Math.min(1, amount));
  return DFN_MAX_DB * a;
}

export interface DfnInstance {
  /** One hop (DFN_HOP samples) in, one hop out. */
  process(frame: Float32Array): Float32Array;
  setAttenLimit(db: number): void;
  free(): void;
}
export interface DfnRuntime {
  create(attenLimitDb: number): DfnInstance;
  /** Build models ahead of time (so create() is instant) until `count` are ready. Optional. */
  prepare?(count: number): void;
}
let dfnRuntime: DfnRuntime | null = null;
/** Supply (or remove) the DeepFilterNet runtime. Chains pick it up on their next block. */
export function setDfnRuntime(rt: DfnRuntime | null) {
  dfnRuntime = rt;
}
export const dfnReady = () => dfnRuntime !== null;

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

// DeepFilterNet runs at full strength; what reaches the listener is *our* gain: the per-bin gain the model applied
// (|wet| / |dry| over a 1024-point STFT), smoothed across 9 bins and over time (fast up, 120 ms down), floored at the
// knob's limit, and applied to the dry signal. Raw model output flutters where the limit is high (its gain flips between
// "noise" and "not noise" frame by frame); smoothing cut that frame-to-frame jitter by about a third on a real take.
export const NR_SMOOTH = { attackMs: 8, releaseMs: 120, bins: 9 };
const SM_N = 1024;
const SM_HOP = 512;
const SM_BINS = SM_N / 2 + 1;
const DFN_DELAY = 1440; // the model's own delay (measured)
const OUT_LAG = FX_LATENCY - DFN_DELAY; // final[j] is played at time j + OUT_LAG
const XFADE = 960;
const RING = 8192; // power of two, ≥ any window we look back over

class NoiseReducer {
  /** Exact FX_LATENCY-sample delay line, always running (it is the dry signal when the model is off or warming up). */
  private delay = new Float64Array(FX_LATENCY);
  private delayPos = 0;
  private inst: DfnInstance | null = null;
  private frame = new Float32Array(DFN_HOP);
  private fill = 0;
  private dryRing = new Float32Array(RING); // raw input by absolute index
  private wetRing = new Float32Array(RING); // model output by absolute index
  private fin = new Float32Array(RING); // finished output by play order
  private tIn = 0;
  private wetN = 0;
  private nextEnd = SM_N;
  private finWr = 0;
  private finRd = 0;
  private fft = new FFT(SM_N);
  private win = new Float64Array(SM_N);
  private xr = new Float64Array(SM_N);
  private xi = new Float64Array(SM_N);
  private yr = new Float64Array(SM_N);
  private yi = new Float64Array(SM_N);
  private acc = new Float64Array(SM_N);
  private gSm = new Float64Array(SM_BINS).fill(1);
  private lg = new Float64Array(SM_BINS);
  private aAtt: number;
  private aRel: number;
  /** Samples since the wet path (re)started: dry until FX_LATENCY, then fades to wet over XFADE. */
  private warm = 0;
  private active = false;
  on = false;
  amount = 0;

  constructor(private rate: number) {
    for (let i = 0; i < SM_N; i++) this.win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SM_N)); // √(periodic Hann)
    this.aAtt = 1 - Math.exp(-SM_HOP / rate / (NR_SMOOTH.attackMs / 1000));
    this.aRel = 1 - Math.exp(-SM_HOP / rate / (NR_SMOOTH.releaseMs / 1000));
  }

  dispose() {
    this.inst?.free();
    this.inst = null;
  }

  /** Is the model currently shaping this channel's output (not dry, not warming up)? */
  get wet() {
    return this.active && this.warm >= FX_LATENCY;
  }

  private restart() {
    this.fill = 0;
    this.tIn = 0;
    this.wetN = 0;
    this.nextEnd = SM_N;
    this.finWr = 0;
    this.finRd = 0;
    this.warm = 0;
    this.acc.fill(0);
    this.gSm.fill(1);
    this.dryRing.fill(0);
    this.wetRing.fill(0);
    for (let i = 0; i < OUT_LAG; i++) this.fin[this.finWr++ & (RING - 1)] = 0;
  }

  /** One smoother frame over aligned samples [end − SM_N, end): dry = input delayed by the model's delay. */
  private smooth(end: number) {
    const { xr, xi, yr, yi, win } = this;
    const start = end - SM_N;
    for (let i = 0; i < SM_N; i++) {
      const j = start + i;
      const di = j - DFN_DELAY;
      xr[i] = (di >= 0 ? this.dryRing[di & (RING - 1)]! : 0) * win[i]!;
      yr[i] = this.wetRing[j & (RING - 1)]! * win[i]!;
      xi[i] = 0;
      yi[i] = 0;
    }
    this.fft.run(xr, xi, false);
    this.fft.run(yr, yi, false);
    // the gain the model applied, in the log domain
    const lg = this.lg;
    for (let k = 0; k < SM_BINS; k++) {
      const ax = Math.hypot(xr[k]!, xi[k]!);
      const ay = Math.hypot(yr[k]!, yi[k]!);
      const g = Math.min(1, ay / (ax + 1e-9));
      lg[k] = Math.log(g > 1e-4 ? g : 1e-4);
    }
    // box smoothing across bins (edges clamped), then floor + asymmetric smoothing over time
    const half = (NR_SMOOTH.bins - 1) >> 1;
    const floor = Math.pow(10, -nrLimitDb(this.amount) / 20);
    let run = 0;
    for (let k = -half; k <= half; k++) run += lg[Math.min(SM_BINS - 1, Math.max(0, k))]!;
    for (let k = 0; k < SM_BINS; k++) {
      const target = Math.max(Math.exp(run / NR_SMOOTH.bins), floor);
      const g = this.gSm[k]!;
      this.gSm[k] = g + (target - g) * (target > g ? this.aAtt : this.aRel);
      run += lg[Math.min(SM_BINS - 1, k + half + 1)]! - lg[Math.max(0, k - half)]!;
    }
    for (let k = 0; k < SM_BINS; k++) {
      const g = this.gSm[k]!;
      xr[k] = xr[k]! * g;
      xi[k] = xi[k]! * g;
      if (k > 0 && k < SM_N / 2) {
        xr[SM_N - k] = xr[k]!;
        xi[SM_N - k] = -xi[k]!;
      }
    }
    this.fft.run(xr, xi, true);
    // overlap-add: √Hann × √Hann = Hann, two of them at hop N/2 sum to 1; the inverse FFT is unscaled (×N)
    const acc = this.acc;
    for (let i = 0; i < SM_N; i++) acc[i] = acc[i]! + (xr[i]! * win[i]!) / SM_N;
    for (let i = 0; i < SM_HOP; i++) this.fin[this.finWr++ & (RING - 1)] = acc[i]!;
    acc.copyWithin(0, SM_HOP);
    acc.fill(0, SM_N - SM_HOP);
  }

  /** `forceDry`: run only the delay line (the caller will copy another channel's result over this one). */
  process(x: Float32Array, out: Float32Array, forceDry = false) {
    const use = !forceDry && this.on && this.amount > 0.001 && dfnRuntime !== null && this.rate === DFN_RATE;
    if (!use) {
      this.active = false; // keep the model: switching back on is then instant (after a short warm-up)
    } else if (!this.active) {
      this.active = true;
      this.inst ??= dfnRuntime!.create(100);
      this.inst.setAttenLimit(100);
      this.restart();
    }
    const d = this.delay;
    let p = this.delayPos;
    for (let i = 0; i < x.length; i++) {
      const dry = d[p]!;
      d[p] = x[i]!;
      p = p + 1 === FX_LATENCY ? 0 : p + 1;
      if (!this.active) {
        out[i] = dry;
        continue;
      }
      this.dryRing[this.tIn++ & (RING - 1)] = x[i]!;
      this.frame[this.fill++] = x[i]!;
      if (this.fill === DFN_HOP) {
        this.fill = 0;
        const y = this.inst!.process(this.frame);
        for (let k = 0; k < DFN_HOP; k++) this.wetRing[this.wetN++ & (RING - 1)] = Number.isFinite(y[k]!) ? y[k]! : 0;
        while (this.nextEnd <= this.wetN) {
          this.smooth(this.nextEnd);
          this.nextEnd += SM_HOP;
        }
      }
      const wet = this.fin[this.finRd++ & (RING - 1)]!;
      const w = this.warm < FX_LATENCY ? 0 : this.warm >= FX_LATENCY + XFADE ? 1 : (this.warm - FX_LATENCY) / XFADE;
      this.warm++;
      out[i] = dry + (wet - dry) * w;
    }
    this.delayPos = p;
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

function sameSamples(a: Float32Array, b: Float32Array): boolean {
  if (a === b) return true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---- the chain ---------------------------------------------------------------------------------

/**
 * A track's FX, streaming, for 1 or 2 channels. Output is delayed by exactly FX_LATENCY samples.
 * Feed blocks of any size; results don't depend on how the stream is cut into blocks.
 */
export class FxChain {
  private nr: NoiseReducer[];
  private hps: Biquad[][] = []; // the high-pass, ahead of the noise reduction
  private eqs: Biquad[][] = []; // low-pass + EQ, after the expander
  private fx: TrackFx = defaultFx();
  private sigHp = "";
  private sigEq = "";
  // compressor
  private env = 0; // detector level (linear)
  private atk: number;
  private rel: number;
  private comp = compParams(0);
  private makeup = 1;
  /** Deepest gain reduction (dB, ≤ 0) since the last read. */
  private grMin = 0;
  private tmp: Float32Array[] = [];
  // expander
  private xEnv = 0;
  private xGain = 0; // current gain, dB (≤ 0)
  private xHold = 0;
  private xOpen: number;
  private xClose: number;
  private xDet: number;
  private xDetRel: number;
  private xHoldN: number;

  constructor(readonly rate: number, readonly channels: number, fx?: TrackFx) {
    this.nr = Array.from({ length: channels }, () => new NoiseReducer(rate));
    this.atk = 1 - Math.exp(-1 / (0.005 * rate));
    this.rel = 1 - Math.exp(-1 / (0.12 * rate));
    this.xOpen = 1 - Math.exp(-1 / (0.003 * rate));
    this.xClose = 1 - Math.exp(-1 / (0.15 * rate));
    this.xDet = 1 - Math.exp(-1 / (0.001 * rate));
    this.xDetRel = 1 - Math.exp(-1 / (0.03 * rate));
    this.xHoldN = Math.round(0.08 * rate);
    this.set(fx ?? defaultFx());
  }

  /** Change the settings; filter state carries over (no clicks from resetting). */
  set(fx: TrackFx) {
    this.fx = fx;
    const on = fx.on;
    for (const n of this.nr) {
      n.on = on && fx.nr.on;
      n.amount = fx.nr.amount;
    }
    const hpf = on && fx.hpf.on ? [biquad("hpf", fx.hpf.freq, this.rate)] : [];
    const rest = on ? fxBiquads({ ...fx, hpf: { ...fx.hpf, on: false } }, this.rate) : [];
    this.sigHp = this.syncBiquads(this.hps, hpf, this.sigHp);
    this.sigEq = this.syncBiquads(this.eqs, rest, this.sigEq);
    this.comp = compParams(fx.comp.amount);
    this.makeup = Math.pow(10, this.comp.makeupDb / 20);
  }

  /** Keep existing filter states where the stage count is unchanged (no clicks from resetting); new stages start at rest. */
  private syncBiquads(lists: Biquad[][], coefs: Coefs[], prevSig: string): string {
    const sig = coefs.map((c) => `${c.b0},${c.b1},${c.b2},${c.a1},${c.a2}`).join("|");
    if (sig === prevSig) return prevSig;
    for (let ch = 0; ch < this.channels; ch++) {
      const old = lists[ch] ?? [];
      lists[ch] = coefs.map((c, i) => {
        const o = old[i];
        if (o) {
          o.c = c;
          return o;
        }
        return new Biquad(c);
      });
    }
    return sig;
  }

  /** Release the noise-reduction models (the render calls this when it is done with the chain). */
  dispose() {
    for (const n of this.nr) n.dispose();
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
    // 1. high-pass (on a copy: the caller's arrays are never touched)
    const hp = Array.from({ length: this.channels }, (_, c) => {
      const src = input[Math.min(c, input.length - 1)]!;
      const bqs = this.hps[c] ?? [];
      if (!bqs.length) return src;
      const y = Float32Array.from(src);
      for (const bq of bqs) bq.run(y);
      return y;
    });
    // 2. noise reduction. A mono track reaches the chain as two identical channels: run the model once and copy it.
    const dup = this.channels === 2 && this.nr[0]!.on && sameSamples(hp[0]!, hp[1]!);
    const out = hp.map((x, c) => {
      const o = new Float32Array(n);
      this.nr[c]!.process(x, o, dup && c === 1);
      return o;
    });
    if (dup) out[1]!.set(out[0]!);
    // 3. expander (its detector hears the high-passed input, 64 ms ahead of `out`), 4. low-pass, 5. EQ, 6. compressor
    if (this.fx.on && this.fx.exp.on) this.expand(hp, out);
    for (let c = 0; c < this.channels; c++) for (const bq of this.eqs[c] ?? []) bq.run(out[c]!);
    if (this.fx.on && this.fx.comp.on) this.compress(out);
    return out;
  }

  /** Downward expander. `det` is the track's input (FX_LATENCY ahead of `chs`, which carries the processed audio). */
  private expand(det: Float32Array[], chs: Float32Array[]) {
    const { thresholdDb, rangeDb } = this.fx.exp;
    const slope = 2; // 3:1 → 2 dB of extra reduction per dB below the threshold
    const knee = 6;
    const n = chs[0]!.length;
    let env = this.xEnv, g = this.xGain, hold = this.xHold;
    for (let i = 0; i < n; i++) {
      let peak = 0;
      for (const c of det) {
        const a = Math.abs(c[i]!);
        if (a > peak) peak = a;
      }
      env += (peak - env) * (peak > env ? this.xDet : this.xDetRel);
      const lvl = env > 1e-9 ? 20 * Math.log10(env) : -180;
      const under = thresholdDb - lvl;
      let want = 0;
      if (under > knee / 2) want = -slope * under;
      else if (under > -knee / 2) want = (-slope * (under + knee / 2) * (under + knee / 2)) / (2 * knee);
      if (want < -rangeDb) want = -rangeDb;
      if (want > g) {
        g += (want - g) * this.xOpen; // opening: fast
        if (want > -0.5) hold = this.xHoldN;
      } else if (hold > 0) hold--;
      else g += (want - g) * this.xClose; // closing: after the hold, slowly
      const lin = g < -0.01 ? Math.pow(10, g / 20) : 1;
      for (const c of chs) c[i] = c[i]! * lin;
    }
    this.xEnv = env;
    this.xGain = g;
    this.xHold = hold;
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
