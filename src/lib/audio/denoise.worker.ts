/*
 * Noise suppression worker: DeepFilterNet3 (public/vendor/deepfilter) run off
 * the main thread. A job resamples to 48 kHz if needed, feeds the model in
 * whole frames, takes its delay back out, steadies what it did (GainSmoother:
 * no flutter on the voice) and resamples back, so what comes out lines up
 * sample for sample with what went in. See denoise.ts for the calls.
 */
import { FrameStream, GainSmoother, MODEL_RATE, Resampler, join } from './denoise-core';

interface DeepFilter {
  default(): Promise<unknown>;
  df_create(model: Uint8Array, attenLim: number): number;
  df_set_atten_lim(st: number, lim: number): void;
  df_process_frame(st: number, input: Float32Array): Float32Array;
}

export type Request =
  | { type: 'start'; job: number; channels: number; rate: number; attenDb: number }
  | { type: 'chunk'; job: number; data: Float32Array[] }
  | { type: 'end'; job: number };
export type Reply = { job: number; data?: Float32Array[]; error?: string };

let df: DeepFilter | null = null;
let model: Uint8Array | null = null;
// The module can't free a model (about 10 MB each), so one per channel is kept and reused.
const pool: number[] = [];

async function load() {
  if (df && model) return df;
  const base = `${self.location.origin}/vendor/deepfilter`;
  const mod = (await import(/* @vite-ignore */ `${base}/df.js`)) as DeepFilter;
  await mod.default();
  model = new Uint8Array(await (await fetch(`${base}/DeepFilterNet3_onnx.bin`)).arrayBuffer());
  df = mod;
  return mod;
}

function stateFor(i: number, attenDb: number) {
  const m = df!;
  pool[i] ??= m.df_create(model!, attenDb);
  const st = pool[i];
  m.df_set_atten_lim(st, attenDb);
  // Clear what the last job left in the model's memory.
  const zeros = new Float32Array(480);
  for (let k = 0; k < 50; k++) m.df_process_frame(st, zeros);
  return st;
}

interface Channel {
  push(x: Float32Array): Float32Array;
  end(): Float32Array;
}
const jobs = new Map<number, Channel[]>();

function channel(st: number, rate: number): Channel {
  const into = new Resampler(rate, MODEL_RATE);
  const model = new FrameStream((frame) => df!.df_process_frame(st, frame));
  const smooth = new GainSmoother(MODEL_RATE);
  const back = new Resampler(MODEL_RATE, rate);
  return {
    push: (x) => {
      const input = into.push(x);
      return back.push(smooth.push(input, model.push(input)));
    },
    end: () => {
      const input = into.end();
      const out = join([model.push(input), model.end()]);
      return join([back.push(join([smooth.push(input, out), smooth.end()])), back.end()]);
    },
  };
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const msg = e.data;
  const reply = (r: Omit<Reply, 'job'>, transfer: Transferable[] = []) =>
    (self as unknown as Worker).postMessage({ job: msg.job, ...r }, transfer);
  try {
    if (msg.type === 'start') {
      await load();
      jobs.set(
        msg.job,
        Array.from({ length: msg.channels }, (_, i) => channel(stateFor(i, msg.attenDb), msg.rate)),
      );
      reply({});
    } else {
      const chans = jobs.get(msg.job);
      if (!chans) throw new Error('No such job');
      const data = msg.type === 'chunk' ? chans.map((c, i) => c.push(msg.data[i])) : chans.map((c) => c.end());
      if (msg.type === 'end') jobs.delete(msg.job);
      reply({ data }, data.map((d) => d.buffer));
    }
  } catch (err) {
    reply({ error: (err as Error).message || String(err) });
  }
};
