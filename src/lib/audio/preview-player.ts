/*
 * The step flow's player (components/steps/StepPlayer.svelte): one
 * AudioContext and the current step's options (Raw / Edit, Original /
 * Cleaned / Removed …), all the same length. Every option plays at once and
 * only the chosen one is heard, so switching never moves the playhead. It
 * plays to the end once, then goes back to the start.
 */
export interface PreviewAudio {
  /** Interleaved, one per option */
  options: Float32Array[];
  channels: number;
  rate: number;
}

export class PreviewPlayer {
  private ctx: AudioContext | null = null;
  private audio: PreviewAudio | null = null;
  private buffers: AudioBuffer[] = [];
  private sources: { src: AudioBufferSourceNode; gain: GainNode }[] = [];
  private t0 = 0;
  private offset = 0;
  private endTimer = 0;
  choice = 0;
  playing = false;
  /** Called when playing stops by itself at the end */
  onended: () => void = () => {};

  get ready() {
    return !!this.audio;
  }

  /** Length in seconds (the longest option) */
  get duration() {
    const a = this.audio;
    return a ? Math.max(0, ...a.options.map((x) => x.length / a.channels / a.rate)) : 0;
  }

  /** New audio for the options; playback carries on from the same place. */
  set(audio: PreviewAudio | null) {
    const was = this.playing;
    const at = this.position();
    this.stopSources();
    this.audio = audio;
    this.buffers = [];
    this.offset = Math.min(at, this.duration);
    if (was && audio) this.startAt(this.offset);
    else this.playing = false;
  }

  private buffer(x: Float32Array) {
    const a = this.audio!;
    const b = this.ctx!.createBuffer(a.channels, Math.max(1, x.length / a.channels), a.rate);
    for (let c = 0; c < a.channels; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = x[i * a.channels + c] ?? 0;
    }
    return b;
  }

  /** Where playback is, in seconds. */
  position(): number {
    if (!this.ctx || !this.playing) return this.offset;
    return Math.min(this.duration, this.offset + Math.max(0, this.ctx.currentTime - this.t0));
  }

  private stopSources() {
    clearTimeout(this.endTimer);
    for (const s of this.sources) {
      s.src.onended = null;
      s.src.stop();
    }
    this.sources = [];
  }

  private startAt(at: number) {
    if (!this.ctx || !this.audio) return;
    if (this.buffers.length !== this.audio.options.length) this.buffers = this.audio.options.map((x) => this.buffer(x));
    const when = this.ctx.currentTime + 0.02;
    this.buffers.forEach((buffer, i) => {
      const src = this.ctx!.createBufferSource();
      src.buffer = buffer;
      const gain = this.ctx!.createGain();
      gain.gain.value = i === this.choice ? 1 : 0;
      src.connect(gain).connect(this.ctx!.destination);
      src.start(when, Math.min(at, buffer.duration));
      this.sources.push({ src, gain });
    });
    this.t0 = when;
    this.offset = at;
    this.playing = true;
    this.endTimer = window.setTimeout(() => {
      this.stopSources();
      this.playing = false;
      this.offset = 0;
      this.onended();
    }, (this.duration - at) * 1000 + 60);
  }

  async play() {
    if (!this.audio) return;
    // Buffers at another rate are resampled by the context
    this.ctx ??= new AudioContext({ sampleRate: this.audio.rate });
    await this.ctx.resume();
    this.stopSources();
    this.startAt(this.offset >= this.duration - 0.05 ? 0 : this.offset);
  }

  pause() {
    this.offset = this.position();
    this.stopSources();
    this.playing = false;
  }

  /** Back to the start, stopped: a new step. */
  reset() {
    this.stopSources();
    this.playing = false;
    this.offset = 0;
  }

  seek(t: number) {
    const was = this.playing;
    this.stopSources();
    this.offset = Math.max(0, Math.min(this.duration, t));
    if (was) this.startAt(this.offset);
  }

  select(i: number) {
    this.choice = i;
    if (!this.ctx) return;
    this.sources.forEach((s, k) => s.gain.gain.setTargetAtTime(k === i ? 1 : 0, this.ctx!.currentTime, 0.01));
  }

  close() {
    this.stopSources();
    this.ctx?.close();
    this.ctx = null;
    this.playing = false;
  }
}
