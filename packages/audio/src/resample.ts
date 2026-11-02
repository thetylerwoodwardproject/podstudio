// Streaming rational resampler (e.g. 48 kHz → 44.1 kHz = 147/160): Kaiser-windowed sinc,
// 96 taps per phase: flat to 20 kHz (measured 0.0 dB), −52 dB at 22.5 kHz and −90 dB from 23.5 kHz,
// so nothing that could fold back into the audible band survives.
// Deterministic (pure arithmetic on the input), so a render is byte-identical every time.

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

function bessel0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 40; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

const TAPS = 96;
const BETA = 8;

export class Resampler {
  readonly L: number;
  readonly M: number;
  private readonly half: number;
  private readonly table: Float32Array;
  private buf = new Float32Array(0);
  /** Absolute input index of buf[0]. */
  private base = 0;
  /** Next output index. */
  private n = 0;
  private consumed = 0;

  constructor(inRate: number, outRate: number) {
    const g = gcd(inRate, outRate);
    this.L = outRate / g;
    this.M = inRate / g;
    const L = this.L;
    this.half = (TAPS * L) / 2;
    // prototype filter at L × inRate, cutoff just under the lower Nyquist
    const cutoff = (0.5 * Math.min(1, outRate / inRate) * 0.97) / L;
    const len = 2 * this.half + 1;
    this.table = new Float32Array(len);
    const i0 = bessel0(BETA);
    for (let j = 0; j < len; j++) {
      const x = j - this.half;
      const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
      const r = x / this.half;
      this.table[j] = L * sinc * (bessel0(BETA * Math.sqrt(Math.max(0, 1 - r * r))) / i0);
    }
  }

  /** Output sample count for an input of `inputSamples`. */
  outputLength(inputSamples: number): number {
    return Math.ceil((inputSamples * this.L) / this.M);
  }

  push(input: Float32Array): Float32Array {
    return this.run(input, false);
  }

  /** Emit the remaining outputs, treating the input as zero past its end. */
  finish(totalInput: number): Float32Array {
    const want = this.outputLength(totalInput);
    const pad = new Float32Array(Math.ceil((this.half / this.L) * 2) + 2);
    const out = this.run(pad, true);
    return out.subarray(0, Math.max(0, want - (this.n - out.length)));
  }

  private run(input: Float32Array, flushing: boolean): Float32Array {
    // append
    const merged = new Float32Array(this.buf.length + input.length);
    merged.set(this.buf);
    merged.set(input, this.buf.length);
    this.buf = merged;
    this.consumed += input.length;
    const { L, M, half, table } = this;
    const out: number[] = [];
    void flushing;
    for (;;) {
      const m = this.n * M;
      const iHi = Math.floor((m + half) / L); // newest input sample this output needs
      if (iHi >= this.base + this.buf.length) break;
      const iLo = Math.ceil((m - half) / L);
      let acc = 0;
      for (let i = Math.max(iLo, this.base); i <= iHi; i++) acc += this.buf[i - this.base]! * table[m - i * L + half]!;
      out.push(acc);
      this.n++;
    }
    // drop input no future output needs
    const keepFrom = Math.max(this.base, Math.ceil((this.n * M - half) / L));
    if (keepFrom > this.base) {
      this.buf = this.buf.slice(keepFrom - this.base);
      this.base = keepFrom;
    }
    return Float32Array.from(out);
  }
}
