/*
 * Podstudio capture worklet. Runs on the audio thread: measures level for the
 * meters and, while recording, hands float samples to the page in ~250 ms
 * chunks, interleaved L R when stereo. Plain JS because it is loaded by URL
 * with addModule().
 *
 * The level's peak is the hottest of what's recorded and every raw input, so
 * clipping at the interface's converter always shows.
 */
class PodstudioRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    // Mono: one input of an interface, or null to sum them all.
    this.channel = typeof opts.channel === 'number' ? opts.channel : null;
    // Stereo: inputs 1 and 2 as left and right (a mono device goes to both).
    this.stereo = opts.channels === 2;
    this.width = this.stereo ? 2 : 1;
    this.chunk = new Float32Array(Math.round(sampleRate / 4) * this.width);
    this.recording = false;
    this.fill = 0;
    this.peak = 0;
    this.sumSq = 0;
    this.count = 0;
    this.levelEvery = Math.round(sampleRate / 30); // ~30 level updates a second
    this.port.onmessage = (e) => {
      if (e.data === 'record') this.recording = true;
      if (e.data === 'stop') {
        this.flush();
        this.recording = false;
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  flush() {
    if (!this.fill) return;
    const out = this.chunk.slice(0, this.fill);
    this.port.postMessage({ type: 'chunk', samples: out }, [out.buffer]);
    this.fill = 0;
  }

  write(s) {
    const a = s < 0 ? -s : s;
    if (a > this.peak) this.peak = a;
    this.sumSq += s * s;
    if (this.recording) {
      this.chunk[this.fill++] = s;
      if (this.fill === this.chunk.length) this.flush();
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    const n = input[0].length;
    if (this.stereo) {
      const l = input[0];
      const r = input[1] || input[0];
      for (let i = 0; i < n; i++) {
        this.write(l[i]);
        this.write(r[i]);
      }
    } else if (this.channel !== null) {
      const ch = input[this.channel] || input[0];
      for (let i = 0; i < n; i++) this.write(ch[i]);
    } else {
      // Sum every input to mono. Averaging would put a single mic on a two-input
      // interface 6 dB low, so a clipped input would read as a safe -6 dBFS.
      for (const c of input) {
        for (let i = 0; i < n; i++) {
          const a = c[i] < 0 ? -c[i] : c[i];
          if (a > this.peak) this.peak = a;
        }
      }
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (const c of input) s += c[i];
        this.write(s);
      }
    }
    this.count += n;
    if (this.count >= this.levelEvery) {
      this.port.postMessage({ type: 'level', peak: this.peak, rms: Math.sqrt(this.sumSq / (this.count * this.width)) });
      this.peak = 0;
      this.sumSq = 0;
      this.count = 0;
    }
    return true;
  }
}

registerProcessor('podstudio-recorder', PodstudioRecorder);
