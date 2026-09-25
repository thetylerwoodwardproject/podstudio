/*
 * The parts of noise suppression that don't need a browser: the fader's
 * mapping, feeding the model in whole frames with its delay taken out, and
 * resampling to and from the model's 48 kHz. The worker (denoise.worker.ts)
 * runs these around DeepFilterNet3; tests run them around a stand-in.
 */

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
