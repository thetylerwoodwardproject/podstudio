// AudioWorklet that captures microphone PCM for solo recordings.
//
// - Meters from the moment the microphone opens, but only *records* between a
//   { type: "begin" } and a { type: "stop" } message. `begin` resets the sample
//   clock to 0, so `total`, every block's `first`, and every retake position are
//   on the recording's own timeline (sample 0 = the first sample of the file); that
//   count, not wall time, is the recording clock.
// - Posts mono Float32 blocks of `postSamples` to the main thread (which cuts them
//   into upload chunks) and a level meter update every ~50 ms.
// - Retake: on a { type: "retake" } message it *adds* the shared retake tone (see
//   lib/capture-contract.ts — the formula below must stay identical, and
//   worklet.test.ts checks it does) into the captured samples starting at the
//   next render quantum, and reports the sample position it started at.
// - { type: "stop" } flushes the partial block and reports { type: "stopped", total }.
const TONE = { freqHz: 1000, durationMs: 250, peak: 0.5, fadeMs: 5 };

class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.postSamples = o.postSamples || 4800;
    this.buf = new Float32Array(this.postSamples);
    this.fill = 0;
    this.total = 0;
    this.toneIdx = -1; // -1 = no tone playing
    this.pendingRetake = false;
    this.stopped = false;
    this.recording = false;
    this.meterEvery = Math.round(sampleRate * 0.05);
    this.meterCount = 0;
    this.peak = 0;
    this.sumSq = 0;
    this.toneLen = Math.round((TONE.durationMs * sampleRate) / 1000);
    this.toneFade = Math.round((TONE.fadeMs * sampleRate) / 1000);
    this.port.onmessage = (e) => {
      if (e.data.type === "begin") {
        this.recording = true;
        this.total = 0;
        this.fill = 0;
        this.toneIdx = -1;
        this.pendingRetake = false;
      } else if (e.data.type === "retake") {
        if (this.recording) this.pendingRetake = true;
      } else if (e.data.type === "stop") this.finish();
    };
  }

  toneAt(i) {
    const len = this.toneLen;
    const fade = this.toneFade;
    const env = i < fade ? 0.5 * (1 - Math.cos((Math.PI * i) / fade)) : i >= len - fade ? 0.5 * (1 - Math.cos((Math.PI * (len - 1 - i)) / fade)) : 1;
    return TONE.peak * env * Math.sin((2 * Math.PI * TONE.freqHz * i) / sampleRate);
  }

  flush() {
    if (this.fill === 0) return;
    const samples = this.buf.slice(0, this.fill);
    this.port.postMessage({ type: "pcm", first: this.total - this.fill, samples }, [samples.buffer]);
    this.fill = 0;
  }

  finish() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.recording) this.flush();
    this.port.postMessage({ type: "stopped", total: this.total });
  }

  process(inputs) {
    if (this.stopped) return false;
    const ch = inputs[0] && inputs[0][0];
    const n = ch ? ch.length : 128;
    if (this.pendingRetake && this.toneIdx < 0) {
      this.pendingRetake = false;
      this.toneIdx = 0;
      this.port.postMessage({ type: "retake", sample: this.total });
    } else if (this.pendingRetake) {
      this.pendingRetake = false; // a tone is already playing
    }
    for (let i = 0; i < n; i++) {
      let v = ch ? ch[i] : 0;
      if (!this.recording) {
        // not recording: level meter only, nothing buffered and the sample clock stays at 0
        const a = v < 0 ? -v : v;
        if (a > this.peak) this.peak = a;
        this.sumSq += v * v;
        if (++this.meterCount >= this.meterEvery) {
          this.port.postMessage({ type: "meter", peak: this.peak, rms: Math.sqrt(this.sumSq / this.meterCount), total: 0 });
          this.meterCount = 0;
          this.peak = 0;
          this.sumSq = 0;
        }
        continue;
      }
      if (this.toneIdx >= 0) {
        v += this.toneAt(this.toneIdx);
        if (++this.toneIdx >= this.toneLen) this.toneIdx = -1;
      }
      if (v > 1) v = 1;
      else if (v < -1) v = -1;
      this.buf[this.fill++] = v;
      this.total++;
      const a = v < 0 ? -v : v;
      if (a > this.peak) this.peak = a;
      this.sumSq += v * v;
      if (this.fill === this.postSamples) this.flush();
      if (++this.meterCount >= this.meterEvery) {
        this.port.postMessage({ type: "meter", peak: this.peak, rms: Math.sqrt(this.sumSq / this.meterCount), total: this.total });
        this.meterCount = 0;
        this.peak = 0;
        this.sumSq = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);
