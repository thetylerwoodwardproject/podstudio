/*
 * Podstudio capture worklet. Runs on the audio thread: measures level for the
 * meters and, while recording, hands mono float samples to the page in
 * ~250 ms chunks. Plain JS because it is loaded by URL with addModule().
 */
class PodstudioRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.chunk = new Float32Array(Math.round(sampleRate / 4));
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

  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = ch[i];
      const a = s < 0 ? -s : s;
      if (a > this.peak) this.peak = a;
      this.sumSq += s * s;
      if (this.recording) {
        this.chunk[this.fill++] = s;
        if (this.fill === this.chunk.length) this.flush();
      }
    }
    this.count += ch.length;
    if (this.count >= this.levelEvery) {
      this.port.postMessage({ type: 'level', peak: this.peak, rms: Math.sqrt(this.sumSq / this.count) });
      this.peak = 0;
      this.sumSq = 0;
      this.count = 0;
    }
    return true;
  }
}

registerProcessor('podstudio-recorder', PodstudioRecorder);
