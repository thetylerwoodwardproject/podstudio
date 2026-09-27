/*
 * The parts of noise suppression that don't need a browser: the fader's
 * mapping, feeding the model in whole frames with its delay taken out, and
 * resampling to and from the model's 48 kHz. The worker (denoise.worker.ts)
 * runs these around DeepFilterNet3; tests run them around a stand-in.
 */
import { fft } from './fft.ts';

/** DeepFilterNet3 works at 48 kHz, in 480-sample frames, 1440 samples behind its input. */
export const MODEL_RATE = 48000;
export const MODEL_FRAME = 480;
export const MODEL_DELAY = 1440;

/**
 * The fader (0–100 %) as the most the model may take away, in dB. Like NS1:
 * 0 leaves the audio alone, halfway allows 20 dB, and the top removes all it can.
 */
export function amountToDb(amount: number): number {
  const a = Math.max(0, Math.min(100, amount));
  if (a === 0) return 0;
  if (a === 100) return 100;
  return Math.round(a * 0.4 * 10) / 10;
}

/** A suggested fader setting for a room's noise floor (dBFS), as the mic check measures it. */
export function suggestAmount(noiseFloorDb: number): number {
  if (!Number.isFinite(noiseFloorDb) || noiseFloorDb <= -60) return 0;
  if (noiseFloorDb <= -45) return 40;
  return 70;
}

/**
 * Feeds a frame-based processor any number of samples at a time and returns
 * output lined up with the input: the processor's delay is dropped from the
 * start, and end() flushes it so the output is exactly as long as the input.
 */
export class FrameStream {
  private buf: Float32Array;
  private fill = 0;
  private skip: number;
  private taken = 0;
  private given = 0;
  private process: (frame: Float32Array) => Float32Array;
  private frame: number;

  constructor(process: (frame: Float32Array) => Float32Array, frame = MODEL_FRAME, delay = MODEL_DELAY) {
    this.process = process;
    this.frame = frame;
    this.buf = new Float32Array(frame);
    this.skip = delay;
  }

  push(input: Float32Array): Float32Array {
    this.taken += input.length;
    const out: Float32Array[] = [];
    let i = 0;
    while (i < input.length) {
      const n = Math.min(this.frame - this.fill, input.length - i);
      this.buf.set(input.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === this.frame) {
        out.push(this.emit(this.process(this.buf.slice())));
        this.fill = 0;
      }
    }
    return join(out);
  }

  /** Push silence through until every input sample has come out. */
  end(): Float32Array {
    const out: Float32Array[] = [];
    const zeros = new Float32Array(this.frame);
    while (this.given < this.taken) {
      const n = this.frame - this.fill;
      this.buf.set(zeros.subarray(0, n), this.fill);
      this.fill = 0;
      out.push(this.emit(this.process(this.buf.slice())));
    }
    return join(out);
  }

  private emit(frame: Float32Array): Float32Array {
    let f = frame;
    if (this.skip) {
      const s = Math.min(this.skip, f.length);
      this.skip -= s;
      f = f.subarray(s);
    }
    // Never give out more than came in (the flush pads with silence).
    const room = this.taken - this.given;
    if (f.length > room) f = f.subarray(0, room);
    this.given += f.length;
    return f;
  }
}

export function join(parts: Float32Array[]): Float32Array {
  if (parts.length === 1) return parts[0];
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * Streaming windowed-sinc resampler. Each output sample is computed at its exact
 * time in the input, so there is no delay to correct, and n input samples give
 * round(n × to / from) out once end() is called.
 */
export class Resampler {
  private readonly ratio: number;
  private readonly half = 16;
  private readonly cutoff: number;
  private hist = new Float32Array(0);
  /** Input index of hist[0] */
  private histStart = 0;
  private taken = 0;
  private next = 0;

  readonly from: number;
  readonly to: number;

  constructor(from: number, to: number) {
    this.from = from;
    this.to = to;
    this.ratio = from / to;
    // Downsampling: filter below the new Nyquist.
    this.cutoff = Math.min(1, to / from) * 0.95;
  }

  get identity() {
    return this.from === this.to;
  }

  push(input: Float32Array): Float32Array {
    if (this.identity) return input;
    const h = new Float32Array(this.hist.length + input.length);
    h.set(this.hist);
    h.set(input, this.hist.length);
    this.hist = h;
    this.taken += input.length;
    return this.run(this.taken - this.half - 1);
  }

  end(): Float32Array {
    if (this.identity) return new Float32Array(0);
    return this.run(Infinity, Math.round((this.taken * this.to) / this.from));
  }

  /** Output samples whose window ends before input index `limit`. */
  private run(limit: number, total = Infinity): Float32Array {
    const out: number[] = [];
    const { half, cutoff, hist, histStart } = this;
    for (;;) {
      if (this.next >= total) break;
      const t = this.next * this.ratio;
      if (Math.floor(t) + half > limit) break;
      const c = Math.floor(t);
      let acc = 0;
      for (let k = c - half + 1; k <= c + half; k++) {
        const j = k - histStart;
        const v = j >= 0 && j < hist.length ? hist[j] : 0;
        const x = t - k;
        const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / half); // Hann window
        acc += v * sinc(x * cutoff) * cutoff * w;
      }
      out.push(acc);
      this.next++;
    }
    // Keep only the history later outputs still need.
    const keepFrom = Math.max(0, Math.floor(this.next * this.ratio) - half - 1 - histStart);
    if (keepFrom > 0) {
      this.hist = this.hist.slice(keepFrom);
      this.histStart += keepFrom;
    }
    return Float32Array.from(out);
  }
}

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/**
 * How much quieter the background got, in dB: the quietest tenth of 100 ms
 * blocks of the input (the room between words), before and after.
 */
export function backgroundReduction(input: Float32Array, output: Float32Array, rate: number): number {
  const block = Math.round(rate / 10);
  const blocks: [number, number][] = [];
  for (let o = 0; o + block <= Math.min(input.length, output.length); o += block) {
    let a = 0;
    let b = 0;
    for (let i = o; i < o + block; i++) {
      a += input[i] * input[i];
      b += output[i] * output[i];
    }
    blocks.push([a, b]);
  }
  if (!blocks.length) return 0;
  blocks.sort((x, y) => x[0] - y[0]);
  const quiet = blocks.slice(0, Math.max(1, Math.round(blocks.length / 10)));
  const a = quiet.reduce((n, x) => n + x[0], 0);
  const b = quiet.reduce((n, x) => n + x[1], 0);
  if (!a) return 0;
  return b ? Math.max(0, 10 * Math.log10(a / b)) : 100;
}

/**
 * A room's noise floor in dBFS: the level of the quietest tenth of 100 ms
 * blocks (the gaps between words), like the mic check measures it. Digital
 * silence (a stopped mic, a filled gap) doesn't count. −Infinity if there's
 * nothing but silence.
 */
export function noiseFloor(x: Float32Array, rate: number): number {
  const block = Math.round(rate / 10);
  const levels: number[] = [];
  for (let o = 0; o + block <= x.length; o += block) {
    let s = 0;
    for (let i = o; i < o + block; i++) s += x[i] * x[i];
    const db = 10 * Math.log10(s / block);
    if (db > -100) levels.push(db);
  }
  if (!levels.length) return -Infinity;
  levels.sort((a, b) => a - b);
  return levels[Math.floor(levels.length * 0.1)];
}

/** What noise suppression took away: the input minus the cleaned audio, sample by sample. */
export function removedPart(input: Float32Array, cleaned: Float32Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] - (cleaned[i] ?? 0);
  return out;
}

/**
 * Steadies what noise suppression does to a voice. The model decides how much
 * to take out of every frequency 100 times a second, and with noise under the
 * speech those decisions jump about: the voice comes out fluttery, and quieter
 * than it went in. This takes the model's gain per frequency (its output over
 * its input, 1024-point frames every 256 samples) and lets it rise at once but
 * fall only over `fallMs`, then applies that to the input. Noise between words
 * still comes down (a little less), the voice keeps its level, and the gain
 * never goes above 1, so nothing is added.
 *
 * Streaming: push the model's input and its lined-up output as they come (the
 * output may trail the input); what comes back lines up with the input, and
 * end() gives the rest, so the total is exactly as long as the input.
 */
export class GainSmoother {
  private readonly N = 1024;
  private readonly H = 256;
  private readonly fall: number;
  private readonly win: Float64Array;
  private readonly prev: Float64Array;
  /** Input not yet paired with output */
  private pending: Float32Array[] = [];
  private pendingLen = 0;
  /** Paired samples from absolute index `base` */
  private x = new Float32Array(0);
  private y = new Float32Array(0);
  private base = 0;
  private total = 0;
  /** Start of the next frame (the first starts before 0, over silence) */
  private next: number;
  /** Overlap-add output from absolute index `emitted` */
  private acc = new Float64Array(0);
  private emitted = 0;
  private re: Float64Array;
  private im: Float64Array;
  private yr: Float64Array;
  private yi: Float64Array;

  constructor(rate: number, fallMs = 80) {
    const { N, H } = this;
    this.fall = Math.exp(-H / ((fallMs / 1000) * rate));
    this.win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    this.prev = new Float64Array(N / 2 + 1).fill(1);
    this.next = -N + H;
    this.re = new Float64Array(N);
    this.im = new Float64Array(N);
    this.yr = new Float64Array(N);
    this.yi = new Float64Array(N);
  }

  push(input: Float32Array, output: Float32Array): Float32Array {
    if (input.length) (this.pending.push(input), (this.pendingLen += input.length));
    this.pair(output);
    while (this.next + this.N <= this.total) this.frame();
    return this.give(Math.min(this.next, this.total));
  }

  end(): Float32Array {
    while (this.next < this.total) this.frame();
    return this.give(this.total);
  }

  /** Line `n` more output samples up with the oldest waiting input. */
  private pair(out: Float32Array) {
    let n = Math.min(out.length, this.pendingLen);
    const xs: Float32Array[] = [];
    while (n > 0) {
      const p = this.pending[0];
      if (p.length <= n) {
        xs.push(p);
        this.pending.shift();
        n -= p.length;
        this.pendingLen -= p.length;
      } else {
        xs.push(p.subarray(0, n));
        this.pending[0] = p.subarray(n);
        this.pendingLen -= n;
        n = 0;
      }
    }
    const add = join(xs);
    // Samples before the next frame's start aren't needed any more.
    const drop = Math.min(Math.max(0, this.next - this.base), this.x.length);
    const grow = (a: Float32Array, b: Float32Array) => {
      const c = new Float32Array(a.length - drop + b.length);
      c.set(a.subarray(drop));
      c.set(b, a.length - drop);
      return c;
    };
    this.x = grow(this.x, add);
    this.y = grow(this.y, out.subarray(0, add.length));
    this.base += drop;
    this.total += add.length;
  }

  private frame() {
    const { N, H, win, prev, re, im, yr, yi } = this;
    const s = this.next;
    for (let i = 0; i < N; i++) {
      const k = s + i - this.base;
      const inside = s + i >= 0 && s + i < this.total;
      re[i] = inside ? this.x[k] * win[i] : 0;
      yr[i] = inside ? this.y[k] * win[i] : 0;
      im[i] = yi[i] = 0;
    }
    fft(re, im);
    fft(yr, yi);
    for (let b = 0; b <= N / 2; b++) {
      const mx = Math.hypot(re[b], im[b]);
      const g = mx > 1e-12 ? Math.min(1, Math.hypot(yr[b], yi[b]) / mx) : 0;
      const sm = g > prev[b] ? g : this.fall * prev[b] + (1 - this.fall) * g;
      prev[b] = sm;
      re[b] *= sm;
      im[b] *= sm;
      if (b > 0 && b < N / 2) {
        re[N - b] = re[b];
        im[N - b] = -im[b];
      }
    }
    // Inverse FFT: conjugate, forward, conjugate (the real part is all that's needed)
    for (let i = 0; i < N; i++) im[i] = -im[i];
    fft(re, im);
    // Hann frames every N/4 add up to 2
    const need = s + N - this.emitted;
    if (need > this.acc.length) {
      const a = new Float64Array(need);
      a.set(this.acc);
      this.acc = a;
    }
    for (let i = 0; i < N; i++) {
      const k = s + i - this.emitted;
      if (k >= 0) this.acc[k] += re[i] / N / 2;
    }
    this.next += H;
  }

  /** Output up to (not including) absolute index `upto`. */
  private give(upto: number): Float32Array {
    const n = Math.max(0, upto - this.emitted);
    const out = Float32Array.from(this.acc.subarray(0, n));
    this.acc = this.acc.slice(n);
    this.emitted += n;
    return out;
  }
}
