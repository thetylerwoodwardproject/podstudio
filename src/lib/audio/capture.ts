/*
 * Microphone capture for recording and mic checks. Browser processing
 * (echo cancellation, noise suppression, auto gain) is turned off so the
 * WAV is the raw mic signal.
 *
 * Events: "level" { peak, rms } in dBFS, "chunk" Float32Array while recording.
 */

export const toDb = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

export interface Level {
  peak: number;
  rms: number;
}

export class MicCapture extends EventTarget {
  ctx: AudioContext | null = null;
  stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;

  static async inputs(): Promise<MediaDeviceInfo[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }

  get sampleRate() {
    return this.ctx?.sampleRate ?? 0;
  }

  /** Label of the input in use, once permission is granted. */
  get label() {
    return this.stream?.getAudioTracks()[0]?.label ?? '';
  }

  get deviceId() {
    return this.stream?.getAudioTracks()[0]?.getSettings().deviceId ?? '';
  }

  async open({ deviceId, sampleRate }: { deviceId?: string; sampleRate: number }) {
    await this.close();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 1,
        sampleRate,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    // The context runs at the chosen rate; Chrome resamples the mic if it differs.
    this.ctx = new AudioContext({ sampleRate, latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule('/worklets/recorder.js');
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'podstudio-recorder', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    source.connect(this.node).connect(mute).connect(this.ctx.destination);
    this.node.port.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'level') this.dispatchEvent(new CustomEvent<Level>('level', { detail: { peak: toDb(d.peak), rms: toDb(d.rms) } }));
      if (d.type === 'chunk') this.dispatchEvent(new CustomEvent<Float32Array>('chunk', { detail: d.samples }));
      if (d.type === 'stopped') this.dispatchEvent(new Event('stopped'));
    };
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  record() {
    this.node?.port.postMessage('record');
  }

  /** Stop recording; resolves after the last partial chunk has been delivered. */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.node) return resolve();
      this.addEventListener('stopped', () => resolve(), { once: true });
      this.node.port.postMessage('stop');
    });
  }

  async close() {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    this.node = null;
    this.stream = null;
    this.ctx = null;
  }
}
