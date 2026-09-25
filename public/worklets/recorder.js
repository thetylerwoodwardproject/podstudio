/*
 * Podstudio capture worklet. Runs on the audio thread: measures level for the
 * meters and, while recording, hands float samples to the page in ~250 ms
 * chunks, interleaved L R when stereo. Plain JS because it is loaded by URL
 * with addModule().
 *
 * The level's `peak` is exactly what's recorded. `hot` also counts every input
 * that goes into it, so clipping at the interface's converter shows even when
 * the mix averages it down. `inputs` has each raw input's own peak.
 */
class PodstudioRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    // Mono: one input of an interface, or null to average them all.
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
    this.inPeaks = [];
    this.port.onmessage = (e) => {
      if (e.data === 'record') this.recording = true;
      // Switch to another input of the device (before recording: the input 1 was silent).
      if (e.data && typeof e.data.channel === 'number') this.channel = e.data.channel;
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
    // Every raw input's peak, before any choosing or mixing.
    for (let c = 0; c < input.length; c++) {
      const ch = input[c];
      let p = this.inPeaks[c] || 0;
      for (let i = 0; i < n; i++) {
        const a = ch[i] < 0 ? -ch[i] : ch[i];
        if (a > p) p = a;
      }
      this.inPeaks[c] = p;
    }
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
      // Every input averaged to mono, which can't go past full scale. (Summing doubled
      // a mono source, which arrives as identical channels: -6 dBFS clipped.)
      const k = 1 / input.length;
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (const c of input) s += c[i];
        this.write(s * k);
      }
    }
    this.count += n;
    if (this.count >= this.levelEvery) {
      const inputs = this.inPeaks.slice(0, input.length);
      // Inputs that feed the recording: the chosen one, inputs 1-2 in stereo, or all when mixed.
      const fed = this.stereo ? inputs.slice(0, 2) : this.channel !== null ? [inputs[this.channel] || 0] : inputs;
      const hot = Math.max(this.peak, ...fed);
      this.port.postMessage({ type: 'level', peak: this.peak, hot, rms: Math.sqrt(this.sumSq / (this.count * this.width)), inputs });
      this.inPeaks = [];
      this.peak = 0;
      this.sumSq = 0;
      this.count = 0;
    }
    return true;
  }
}

registerProcessor('podstudio-recorder', PodstudioRecorder);
