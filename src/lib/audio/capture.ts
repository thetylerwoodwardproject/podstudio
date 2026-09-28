/*
 * Microphone capture for recording and mic checks. Browser processing
 * (echo cancellation, noise suppression, auto gain) is turned off so the
 * WAV is the raw mic signal.
 *
 * Recording goes through MediaRecorder as lossless PCM, on the microphone's
 * own clock. Web Audio (the AudioWorklet) only drives the meters: it runs on
 * the output device's clock, and with an interface in and other speakers out
 * Chrome drops or repeats samples to keep the two in step, which is crackle
 * in a recording. Browsers without PCM MediaRecorder record through the
 * worklet as before.
 *
 * Events: "level" { peak, rms } in dBFS, "chunk" Float32Array while recording
 * (interleaved L R when stereo), "mic-state" when the mic is paused by the
 * system (the audio engine suspended or interrupted, the track muted or
 * ended) or comes back, and "silent-input" when the recorded input is
 * digitally silent while another input of the device has signal.
 */

import { parseInput } from './devices';
import { isIOS } from '../platform';
import type { Channels } from './wav';
import { WebmPcmReader, pickChannels } from './webm-pcm';

const PCM = 'audio/webm;codecs=pcm';

export const toDb = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

export interface Level {
  /** Peak of what's recorded (dBFS) */
  peak: number;
  /** Peak of what's recorded and every input feeding it: over -0.5 dBFS means clipping */
  hot: number;
  rms: number;
  /** Each raw input's peak (dBFS), before choosing or mixing */
  inputs: number[];
}

/** What the browser actually opened, to check against what was asked for. */
export interface Opened {
  label: string;
  /** Inputs the device delivers */
  inputs: number;
  /** The device's own rate, when the browser reports it */
  deviceRate?: number;
  /** The rate Podstudio records at */
  sampleRate: number;
  /** Browser processing that ended up on anyway (it alters levels) */
  processing: string[];
}

export class MicCapture extends EventTarget {
  ctx: AudioContext | null = null;
  stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;

  static async inputs(): Promise<MediaDeviceInfo[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }

  /** Records through MediaRecorder (lossless PCM) rather than the worklet */
  static get pcmRecording() {
    return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(PCM);
  }

  /**
   * The rate the recording is made at. MediaRecorder records at the device's own
   * rate; the worklet at the audio context's. A 'format' event corrects it if the
   * recording says otherwise.
   */
  get sampleRate() {
    if (MicCapture.pcmRecording) return this.stream?.getAudioTracks()[0]?.getSettings().sampleRate || this.ctx?.sampleRate || 0;
    return this.ctx?.sampleRate ?? 0;
  }

  private recorder: MediaRecorder | null = null;
  private recorded: Promise<void> = Promise.resolve();
  private startedAt = 0;

  /** Seconds since recording started, on the wall clock (markers use this, not samples saved). */
  elapsed() {
    return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  /** Label of the input in use, once permission is granted. */
  get label() {
    return this.stream?.getAudioTracks()[0]?.label ?? '';
  }

  get deviceId() {
    return this.stream?.getAudioTracks()[0]?.getSettings().deviceId ?? '';
  }

  /** Input channel being recorded in mono, or null when all inputs are averaged */
  channel: number | null = null;
  /** Whether the recorder is running */
  recording = false;
  /** A deliberate session pause: the mic remains open, but no samples are accepted. */
  paused = false;
  /** Since when the recorded input has been silent while another one has signal */
  private silentSince = 0;
  private silentTold = false;

  /** The mic as the system has it: running, or paused by it (and why). */
  micState(): 'ok' | 'suspended' | 'interrupted' | 'muted' | 'ended' {
    const track = this.stream?.getAudioTracks()[0];
    if (track?.readyState === 'ended') return 'ended';
    if (track?.muted) return 'muted';
    const st = this.ctx?.state as string | undefined;
    if (st === 'suspended' || st === 'interrupted') return st;
    return 'ok';
  }

  /** Record another input of the same device, before recording starts (the file can't change mid-way). */
  useInput(channel: number) {
    if (this.recording || this.channels === 2) return false;
    this.channel = channel;
    this.node?.port.postMessage({ channel });
    this.silentSince = 0;
    this.silentTold = false;
    return true;
  }

  /** Everything about the open mic, for diagnostics. */
  diagnostics() {
    const track = this.stream?.getAudioTracks()[0];
    return {
      label: track?.label,
      settings: track?.getSettings(),
      muted: track?.muted,
      readyState: track?.readyState,
      contextState: this.ctx?.state,
      contextRate: this.ctx?.sampleRate,
      channel: this.channel,
      channels: this.channels,
      recording: this.recording,
    };
  }

  /** Input 1 (or the chosen one) silent while another input has signal, for 2 s: say which one does. */
  private checkInputs(inputs: number[]) {
    if (this.channels === 2 || this.channel === null || inputs.length < 2) return;
    const own = inputs[this.channel] ?? -Infinity;
    const loud = inputs.reduce((best, db, i) => (i !== this.channel && db > (inputs[best] ?? -Infinity) ? i : best), this.channel === 0 ? 1 : 0);
    if (!(own < -100 && inputs[loud] > -60)) {
      this.silentSince = 0;
      return;
    }
    const now = performance.now();
    this.silentSince ||= now;
    if (now - this.silentSince < 2000 || this.silentTold) return;
    this.silentTold = true;
    this.dispatchEvent(new CustomEvent('silent-input', { detail: { silent: this.channel, live: loud, recording: this.recording } }));
  }
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
        // On an iPhone or iPad the mic is mono: asking for two channels can give a
        // second, silent one (and input 1 is what's recorded), so ask for one.
        channelCount: { ideal: isIOS() && this.channel === 0 ? 1 : Math.max(2, (this.channel ?? 0) + 1) },
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
      if (d.type === 'level') {
        const inputs = (d.inputs ?? []).map(toDb);
        this.dispatchEvent(new CustomEvent<Level>('level', { detail: { peak: toDb(d.peak), hot: toDb(d.hot ?? d.peak), rms: toDb(d.rms), inputs } }));
        this.checkInputs(inputs);
      }
      if (d.type === 'chunk') this.dispatchEvent(new CustomEvent<Float32Array>('chunk', { detail: d.samples }));
      if (d.type === 'stopped') this.dispatchEvent(new Event('stopped'));
    };
    // The system can pause the mic (a call, Siri, another app, the page leaving the screen).
    const tell = () => this.dispatchEvent(new CustomEvent('mic-state', { detail: this.micState() }));
    const track = this.stream.getAudioTracks()[0];
    for (const ev of ['mute', 'unmute', 'ended']) track?.addEventListener(ev, tell);
    this.ctx.addEventListener('statechange', tell);
    this.silentSince = 0;
    this.silentTold = false;
    // Without a click on this page, Chrome keeps audio suspended; don't wait on it.
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  /**
   * The mic as a live track, for voice follow. It's the device's own track (on an
   * interface, every input mixed), so it works before any click on the page and
   * hears everyone on that device.
   */
  opened(): Opened | null {
    const track = this.stream?.getAudioTracks()[0];
    if (!track || !this.ctx) return null;
    const s = track.getSettings() as MediaTrackSettings & { autoGainControl?: boolean; noiseSuppression?: boolean; echoCancellation?: boolean };
    const processing = [
      s.autoGainControl && 'auto gain',
      s.noiseSuppression && 'noise suppression',
      s.echoCancellation && 'echo cancellation',
    ].filter(Boolean) as string[];
    return { label: track.label, inputs: s.channelCount ?? 1, deviceRate: s.sampleRate, sampleRate: this.ctx.sampleRate, processing };
  }

  voiceTrack(): MediaStreamTrack | null {
    return this.stream?.getAudioTracks()[0] ?? null;
  }


  record() {
    this.startedAt = performance.now();
    this.recording = true;
    this.paused = false;
    if (!MicCapture.pcmRecording || !this.stream) {
      this.node?.port.postMessage('record');
      return;
    }
    const reader = new WebmPcmReader();
    let chain = Promise.resolve();
    let told = false;
    const rec = new MediaRecorder(this.stream, { mimeType: PCM });
    // Chunks are read in order, one after another.
    rec.ondataavailable = (e) => {
      chain = chain
        .then(async () => {
          for (const samples of reader.push(new Uint8Array(await e.data.arrayBuffer()))) {
            const f = reader.format!;
            if (!told) {
              told = true;
              this.dispatchEvent(new CustomEvent<number>('format', { detail: f.sampleRate }));
            }
            this.dispatchEvent(new CustomEvent<Float32Array>('chunk', { detail: pickChannels(samples, f.channels, this.channel, this.channels === 2) }));
          }
        })
        .catch((err) => {
          this.dispatchEvent(new CustomEvent<string>('error', { detail: (err as Error).message }));
        });
    };
    this.recorded = new Promise((resolve) => (rec.onstop = () => chain.then(resolve)));
    rec.start(250);
    this.recorder = rec;
  }

  /** Stop accepting samples without closing the microphone or ending this take. */
  pause() {
    if (!this.recording || this.paused) return;
    this.paused = true;
    if (this.recorder && this.recorder.state === 'recording') {
      this.recorder.requestData();
      this.recorder.pause();
    } else this.node?.port.postMessage('pause');
  }

  /** Continue the same take after a deliberate pause. */
  resumeRecording() {
    if (!this.recording || !this.paused) return;
    this.paused = false;
    if (this.recorder && this.recorder.state === 'paused') this.recorder.resume();
    else this.node?.port.postMessage('resume');
  }

  /** Stop recording; resolves after the last partial chunk has been delivered. */
  stop(): Promise<void> {
    this.recording = false;
    this.paused = false;
    if (this.recorder) {
      const done = this.recorded;
      if (this.recorder.state !== 'inactive') this.recorder.stop();
      this.recorder = null;
      return done;
    }
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
