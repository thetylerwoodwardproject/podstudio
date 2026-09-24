/*
 * Microphone capture for recording and mic checks. Browser processing
 * (echo cancellation, noise suppression, auto gain) is turned off so the
 * WAV is the raw mic signal.
 *
 * Events: "level" { peak, rms } in dBFS, "chunk" Float32Array while recording
 * (interleaved L R when stereo).
 */

import { parseInput } from './devices';
import type { Channels } from './wav';

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

  /** Input channel being recorded in mono, or null when all inputs are summed */
  channel: number | null = null;
  /** 1 for mono, 2 for stereo (inputs 1 and 2 as left and right) */
  channels: Channels = 1;

  /**
   * Open a microphone. `deviceId` is a stored input value (see devices.ts):
   * '' for the system default, a device id, or 'id#n' for one input of an interface
   * (mono only: stereo always records the device's inputs 1 and 2).
   */
  async open({ deviceId, sampleRate, channels = 1 }: { deviceId?: string; sampleRate: number; channels?: Channels }) {
    await this.close();
    const input = parseInput(deviceId);
    this.channels = channels;
    this.channel = channels === 2 ? null : input.channel;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: input.deviceId ? { exact: input.deviceId } : undefined,
        // The device's own inputs, mixed here if at all. Chrome's mono downmix averages
        // them, so a mic on input 1 of a two-input interface would meter and record
        // 6 dB low and clip at -6 dBFS.
        channelCount: { ideal: Math.max(2, (this.channel ?? 0) + 1) },
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
    const inputs = Math.max(1, this.stream.getAudioTracks()[0]?.getSettings().channelCount ?? 1);
    this.node = new AudioWorkletNode(this.ctx, 'podstudio-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: inputs,
      channelCountMode: 'explicit',
      // Keep interface inputs separate instead of up/down-mixing them as speakers.
      channelInterpretation: 'discrete',
      processorOptions: { channel: this.channel, channels },
    });
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    source.connect(this.node).connect(mute).connect(this.ctx.destination);
    this.node.port.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'level') this.dispatchEvent(new CustomEvent<Level>('level', { detail: { peak: toDb(d.peak), rms: toDb(d.rms) } }));
      if (d.type === 'chunk') this.dispatchEvent(new CustomEvent<Float32Array>('chunk', { detail: d.samples }));
      if (d.type === 'stopped') this.dispatchEvent(new Event('stopped'));
    };
    // Without a click on this page, Chrome keeps audio suspended; don't wait on it.
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  /**
   * The mic as a live track, for voice follow. It's the device's own track (on an
   * interface, every input mixed), so it works before any click on the page and
   * hears everyone on that device.
   */
  voiceTrack(): MediaStreamTrack | null {
    return this.stream?.getAudioTracks()[0] ?? null;
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
