// AudioWorklet processors for the editor preview. Bundled as a worker so the browser runs the very
// same DSP modules the worker's export uses:
// - "podstudio-fx": one per track bus — the track's FxChain (packages/audio/src/fx.ts), stereo,
//   constant FX_LATENCY. Posts gain reduction (for the compressor meter) about 20× a second.
// - "podstudio-meter": on the master — L/R peak and RMS, and BS.1770 loudness of the stereo mix and of
//   its mono fold-down (momentary, short-term, integrated, LRA, true peak), every 4096 samples.
import "./worklet-text-shim"; // must stay first: the DeepFilterNet glue needs TextDecoder when it loads
import { createDfnRuntime } from "@podstudio/audio/dfn-runtime";
import { FxChain, defaultFx, dfnReady, normalizeFx, setDfnRuntime, type DfnRuntime } from "@podstudio/audio/fx";
import { LoudnessMeter, TruePeakMeter } from "@podstudio/audio/loudness";

// AudioWorkletGlobalScope (not in the DOM lib)
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: Record<string, unknown> });
}

let dfnRuntime: DfnRuntime | null = null;

class FxProcessor extends AudioWorkletProcessor {
  private chain: FxChain;
  private quanta = 0;
  constructor(options?: { processorOptions?: Record<string, unknown> }) {
    super(options);
    // settings at construction, so they apply from the very first block
    this.chain = new FxChain(sampleRate, 2, normalizeFx(options?.processorOptions?.fx) ?? defaultFx());
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data?.type === "fx") this.chain.set(normalizeFx(e.data.fx) ?? defaultFx());
      else if (e.data?.type === "dfn") {
        // the page compiled the DeepFilterNet wasm and fetched the model; every FX node in this context shares them
        try {
          if (!dfnReady()) dfnRuntime = createDfnRuntime(e.data.module as WebAssembly.Module, new Uint8Array(e.data.model as ArrayBuffer));
          setDfnRuntime(dfnRuntime);
          this.port.postMessage({ type: "dfn", ok: true });
        } catch (err) {
          this.port.postMessage({ type: "dfn", ok: false, error: String(err) });
        }
      } else if (e.data?.type === "dfn-prepare" && dfnRuntime) {
        try {
          dfnRuntime.prepare?.(Number(e.data.count) || 0);
        } catch {
          /* the first real use will build one instead */
        }
      }
    };
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0]!;
    const n = out[0]?.length ?? 128;
    const inp = inputs[0] ?? [];
    const zero = new Float32Array(n);
    const l = inp[0] ?? zero;
    const r = inp[1] ?? l;
    const y = this.chain.process([l, r]);
    out[0]?.set(y[0]!);
    out[1]?.set(y[1]!);
    if (++this.quanta % 19 === 0) this.port.postMessage({ type: "gr", db: this.chain.takeGainReduction() });
    return true;
  }
}

class MeterProcessor extends AudioWorkletProcessor {
  private stereo = new LoudnessMeter(sampleRate, 2);
  private mono = new LoudnessMeter(sampleRate, 1);
  private tpS = new TruePeakMeter(2);
  private tpM = new TruePeakMeter(1);
  private n = 0;
  private pk = [0, 0];
  private sq = [0, 0];
  private slow = 0;
  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data?.type === "reset") {
        this.stereo = new LoudnessMeter(sampleRate, 2);
        this.mono = new LoudnessMeter(sampleRate, 1);
        this.tpS = new TruePeakMeter(2);
        this.tpM = new TruePeakMeter(1);
      }
    };
  }
  process(inputs: Float32Array[][]) {
    const inp = inputs[0] ?? [];
    const len = inp[0]?.length ?? 128;
    const l = inp[0] ?? new Float32Array(len);
    const r = inp[1] ?? l;
    const m = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const a = l[i]!;
      const b = r[i]!;
      m[i] = (a + b) / 2;
      const aa = Math.abs(a);
      const bb = Math.abs(b);
      if (aa > this.pk[0]!) this.pk[0] = aa;
      if (bb > this.pk[1]!) this.pk[1] = bb;
      this.sq[0] += a * a;
      this.sq[1] += b * b;
    }
    this.stereo.push([l, r]);
    this.mono.push([m]);
    this.tpS.push([l, r]);
    this.tpM.push([m]);
    this.n += len;
    if (this.n >= 4096) {
      // integrated and LRA walk the whole history: about four times a second is plenty
      const full = ++this.slow % 3 === 0;
      this.port.postMessage({
        type: "levels",
        peak: [this.pk[0], this.pk[1]],
        rms: [Math.sqrt(this.sq[0]! / this.n), Math.sqrt(this.sq[1]! / this.n)],
        stereo: { m: this.stereo.momentary(), s: this.stereo.shortTerm(), ...(full ? { i: this.stereo.integrated(), lra: this.stereo.lra() } : {}), tp: this.tpS.db() },
        mono: { m: this.mono.momentary(), s: this.mono.shortTerm(), ...(full ? { i: this.mono.integrated(), lra: this.mono.lra() } : {}), tp: this.tpM.db() },
      });
      this.n = 0;
      this.pk = [0, 0];
      this.sq = [0, 0];
    }
    return true;
  }
}

registerProcessor("podstudio-fx", FxProcessor);
registerProcessor("podstudio-meter", MeterProcessor);
