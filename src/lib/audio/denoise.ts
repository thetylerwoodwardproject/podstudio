/*
 * Noise suppression, like Waves NS1: one fader, adaptive, no noise print.
 * DeepFilterNet3 runs in a worker (denoise.worker.ts). The original recording
 * is never changed: a cleaned copy is kept beside it (see VariantWriter in
 * takes.ts), and exports and previews read whichever they need.
 */
import { amountToDb, backgroundReduction } from './denoise-core';
import { VariantWriter, hasVariant, readFrames, type TakeMeta } from './takes';
import { encodeWav } from './wav';
import type { Reply, Request } from './denoise.worker';

export { amountToDb, suggestAmount } from './denoise-core';

/** The folder name of a take's cleaned copy at a fader setting. */
export const variantName = (amount: number) => `ns-${Math.round(amount)}`;

let worker: Worker | null = null;
let nextJob = 1;
const waiting = new Map<number, [(r: Reply) => void, (e: Error) => void]>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./denoise.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const w = waiting.get(e.data.job);
    waiting.delete(e.data.job);
    if (e.data.error) {
      w?.[1](new Error(e.data.error));
      // A failed model can't be trusted afterwards: start fresh next time.
      cancel();
    } else w?.[0](e.data);
  };
  worker.onerror = (e) => {
    for (const [, [, fail]] of waiting) fail(new Error(e.message || 'Noise suppression stopped'));
    waiting.clear();
    worker = null;
  };
  return worker;
}

function ask(msg: Request, transfer: Transferable[] = []): Promise<Reply> {
  const w = getWorker();
  return new Promise((resolve, reject) => {
    waiting.set(msg.job, [resolve, reject]);
    w.postMessage(msg, transfer);
  });
}

/** Stop whatever is running (the worker and its models are thrown away). */
export function cancel() {
  worker?.terminate();
  worker = null;
  for (const [, [, fail]] of waiting) fail(new DOMException('Cancelled', 'AbortError'));
  waiting.clear();
}

const planar = (x: Float32Array, channels: number) =>
  Array.from({ length: channels }, (_, c) => {
    const out = new Float32Array(Math.floor(x.length / channels));
    for (let i = 0; i < out.length; i++) out[i] = x[i * channels + c];
    return out;
  });

/** Interleave, trimmed or padded with silence to exactly `frames`. */
function interleave(chans: Float32Array[], frames: number) {
  const n = chans.length;
  const out = new Float32Array(frames * n);
  for (let c = 0; c < n; c++) {
    const ch = chans[c];
    for (let i = 0; i < Math.min(frames, ch.length); i++) out[i * n + c] = ch[i];
  }
  return out;
}

// The worker keeps one model per channel, so jobs take turns.
let turn: Promise<unknown> = Promise.resolve();
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const next = turn.then(job, job);
  turn = next.catch(() => {});
  return next;
}

/**
 * Clean interleaved samples in chunks. `read(from, count)` supplies the input
 * frames, `write` gets the cleaned frames in order, lined up with the input.
 */
function run(...args: Parameters<typeof runNow>) {
  return inTurn(() => runNow(...args));
}

async function runNow(
  frames: number,
  channels: number,
  rate: number,
  amount: number,
  read: (from: number, count: number) => Promise<Float32Array>,
  write: (x: Float32Array) => Promise<void> | void,
  onProgress?: (done: number) => void,
) {
  const job = nextJob++;
  await ask({ type: 'start', job, channels, rate, attenDb: amountToDb(amount) });
  const chunk = rate * 10;
  // The worker's output trails its input; hold it until it lines up.
  let pending: Float32Array[][] = [];
  let pendingFrames = 0;
  let written = 0;
  const take = async (data: Float32Array[], final = false) => {
    pending.push(data);
    pendingFrames += data[0]?.length ?? 0;
    const ready = final ? frames - written : Math.min(pendingFrames, frames - written);
    if (ready <= 0 && !final) return;
    const joined = Array.from({ length: channels }, (_, c) => {
      const out = new Float32Array(pendingFrames);
      let o = 0;
      for (const p of pending) {
        out.set(p[c], o);
        o += p[c].length;
      }
      return out;
    });
    await write(interleave(joined.map((c) => c.subarray(0, ready)), ready));
    written += ready;
    const rest = joined.map((c) => c.slice(ready));
    pending = [rest];
    pendingFrames = rest[0].length;
  };
  for (let from = 0; from < frames; from += chunk) {
    const count = Math.min(chunk, frames - from);
    const data = planar(await read(from, count), channels);
    const r = await ask({ type: 'chunk', job, data }, data.map((d) => d.buffer));
    await take(r.data!);
    onProgress?.((from + count) / frames);
  }
  const r = await ask({ type: 'end', job });
  await take(r.data!, true);
}

/**
 * Make (or reuse) the cleaned copy of a whole take at this fader setting.
 * Returns its variant name for rangesWav() / takeWav(), or null at 0 %.
 */
export async function denoiseTake(meta: TakeMeta, amount: number, onProgress?: (done: number) => void): Promise<string | null> {
  if (amount <= 0) return null;
  const variant = variantName(amount);
  if (await hasVariant(meta, variant)) {
    onProgress?.(1);
    return variant;
  }
  const out = await VariantWriter.open(meta, variant);
  const channels = meta.channels ?? 1;
  await run(meta.samples, channels, meta.sampleRate, amount, (from, count) => readFrames(meta, from, count), (x) => out.write(x), onProgress);
  await out.done();
  return variant;
}

export interface Preview {
  before: Blob;
  after: Blob;
  /** dB the background came down by */
  reduction: number;
}

/** Clean a stretch of samples held in memory (the mic check's test recording, a preview). */
export async function denoiseSamples(samples: Float32Array, channels: number, rate: number, amount: number): Promise<Float32Array> {
  if (amount <= 0) return samples;
  const frames = Math.floor(samples.length / channels);
  const out: Float32Array[] = [];
  await run(frames, channels, rate, amount, async (from, count) => samples.slice(from * channels, (from + count) * channels), (x) => {
    out.push(x);
  });
  const all = new Float32Array(frames * channels);
  let o = 0;
  for (const x of out) {
    all.set(x, o);
    o += x.length;
  }
  return all;
}

/** Before and after for `seconds` of a take, starting `from` seconds in. */
export async function previewTake(meta: TakeMeta, amount: number, seconds = 30, from = 0): Promise<Preview> {
  const channels = meta.channels ?? 1;
  const start = Math.max(0, Math.min(meta.samples, Math.round(from * meta.sampleRate)));
  const frames = Math.min(meta.samples - start, Math.round(seconds * meta.sampleRate));
  const input = await readFrames(meta, start, frames);
  return previewSamples(input, channels, meta.sampleRate, meta.bitDepth, amount);
}

export async function previewSamples(input: Float32Array, channels: number, rate: number, bitDepth: 16 | 24, amount: number): Promise<Preview> {
  const output = await denoiseSamples(input, channels, rate, amount);
  const opts = { sampleRate: rate, bitDepth, channels: channels as 1 | 2 };
  const mono = (x: Float32Array) => (channels === 1 ? x : x.filter((_, i) => i % channels === 0));
  return {
    before: encodeWav([input], opts),
    after: encodeWav([output], opts),
    reduction: backgroundReduction(mono(input), mono(output), rate),
  };
}
