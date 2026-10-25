import { CAPTURE, floatToPcm24 } from "~/lib/capture-contract";

// Microphone capture: getUserMedia → AudioContext at 48 kHz → the pcm-capture
// AudioWorklet (see public/pcm-capture.worklet.js). Processing that would colour
// the take — echo cancellation, noise suppression, auto gain — is switched off.
export interface InputDevice {
  deviceId: string;
  label: string;
}

export interface ChunkOut {
  sequence: number;
  firstSample: number;
  sampleCount: number;
  bytes: Uint8Array;
  sha256: string;
}

export async function listInputs(): Promise<InputDevice[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "audioinput").map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface EngineHandlers {
  onMeter: (peak: number, rms: number) => void;
  /** Called, in order, with each finished chunk (the last one may be shorter). Must resolve once it is journaled. */
  onChunk: (chunk: ChunkOut) => Promise<void>;
  onRetake: (sample: number) => void;
  onProgress: (totalSamples: number) => void;
  onError: (message: string) => void;
}

export class CaptureEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private acc: Float32Array[] = [];
  private accSamples = 0;
  private firstSample = 0;
  private sequence = 0;
  private chain: Promise<void> = Promise.resolve();
  private stoppedResolve: (() => void) | null = null;
  inputRate = 0;
  deviceLabel = "";

  constructor(private h: EngineHandlers) {}

  /** Opens the mic and starts metering; nothing is recorded until `begin()`. */
  async open(deviceId?: string) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const track = this.stream.getAudioTracks()[0]!;
    this.deviceLabel = track.label;
    this.inputRate = track.getSettings().sampleRate ?? 0;
    this.ctx = new AudioContext({ sampleRate: CAPTURE.sampleRate, latencyHint: "interactive" });
    if (this.ctx.sampleRate !== CAPTURE.sampleRate) throw new Error(`This browser runs audio at ${this.ctx.sampleRate} Hz; recordings need ${CAPTURE.sampleRate} Hz.`);
    await this.ctx.audioWorklet.addModule("/pcm-capture.worklet.js");
    this.node = new AudioWorkletNode(this.ctx, "pcm-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { postSamples: 4800 } });
    this.node.port.onmessage = (e) => this.onMessage(e.data);
    const mute = this.ctx.createGain();
    mute.gain.value = 0; // keeps the graph pulling audio without playing the mic through the speakers
    this.ctx.createMediaStreamSource(this.stream).connect(this.node).connect(mute).connect(this.ctx.destination);
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  private recording = false;

  begin() {
    this.node?.port.postMessage({ type: "begin" });
    this.recording = true;
    this.acc = [];
    this.accSamples = 0;
    this.firstSample = 0;
    this.sequence = 0;
  }

  retake() {
    if (this.recording) this.node?.port.postMessage({ type: "retake" });
  }

  private onMessage(m: { type: string; [k: string]: unknown }) {
    if (m.type === "meter") {
      this.h.onMeter(m.peak as number, m.rms as number);
      if (this.recording) this.h.onProgress(m.total as number);
    } else if (m.type === "pcm" && this.recording) {
      const samples = m.samples as Float32Array;
      this.acc.push(samples);
      this.accSamples += samples.length;
      while (this.accSamples >= CAPTURE.chunkSamples) this.cut(CAPTURE.chunkSamples);
    } else if (m.type === "retake") {
      this.h.onRetake(m.sample as number);
    } else if (m.type === "stopped") {
      this.stoppedResolve?.();
    }
  }

  /** Takes `count` samples off the accumulator as one chunk. Chunks are journaled strictly in order. */
  private cut(count: number) {
    const out = new Float32Array(count);
    let at = 0;
    while (at < count) {
      const head = this.acc[0]!;
      const take = Math.min(head.length, count - at);
      out.set(head.subarray(0, take), at);
      at += take;
      if (take === head.length) this.acc.shift();
      else this.acc[0] = head.subarray(take);
    }
    this.accSamples -= count;
    const sequence = this.sequence++;
    const firstSample = this.firstSample;
    this.firstSample += count;
    const bytes = floatToPcm24(out);
    this.chain = this.chain
      .then(async () => this.h.onChunk({ sequence, firstSample, sampleCount: count, bytes, sha256: await sha256Hex(bytes) }))
      .catch((err) => this.h.onError(err instanceof Error ? err.message : String(err)));
  }

  /** Stops capture, flushes the partial last chunk, and resolves once every chunk has been handed over and journaled. */
  async stop() {
    if (!this.recording) return;
    await new Promise<void>((resolve) => {
      this.stoppedResolve = resolve;
      this.node?.port.postMessage({ type: "stop" });
      setTimeout(resolve, 2000); // the worklet always answers; this only guards a dead audio thread
    });
    if (this.accSamples > 0) this.cut(this.accSamples);
    this.recording = false;
    await this.chain;
  }

  async close() {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.stream = null;
    this.node = null;
  }
}
