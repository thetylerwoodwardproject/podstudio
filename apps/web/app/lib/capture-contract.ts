// The shared capture contract (BUILD_PLAN "Recording and project contracts"): what a
// solo recording is, byte for byte, on the browser, on the wire and in the finished
// WAV. Pure and dependency-free so the client, the server and the tests agree.
//
// Clock: sample counts, not wall time. `firstSample` of a chunk and every retake
// annotation are positions on the capture clock (48 kHz context samples since the
// recording started); upload timing never enters into it.
export const CAPTURE = {
  sampleRate: 48_000,
  channels: 1,
  bitDepth: 24,
  bytesPerSample: 3,
  /** Samples per uploaded chunk: 2 s at 48 kHz (≈ 288 KB mono 24-bit, far below any multipart minimum). */
  chunkSamples: 96_000,
  /** Largest chunk the server accepts, in samples (a partial final chunk is smaller). */
  maxChunkSamples: 192_000,
} as const;

// Retake (K): a short, clean tone is *added into the captured audio* so a cleanup
// pass can find retakes in the file itself, not just in the annotation list.
export const RETAKE_TONE = {
  freqHz: 1000,
  durationMs: 250,
  /** Peak amplitude (0..1): −6 dBFS, loud enough to find in a noisy take. */
  peak: 0.5,
  /** Raised-cosine fade in/out, to avoid clicks. */
  fadeMs: 5,
} as const;

export const toneLength = (sampleRate: number) => Math.round((RETAKE_TONE.durationMs * sampleRate) / 1000);

/** The tone's value at `i` samples after it starts (0 outside the tone). The worklet implements the same formula. */
export function toneSample(i: number, sampleRate: number): number {
  const len = toneLength(sampleRate);
  if (i < 0 || i >= len) return 0;
  const fade = Math.round((RETAKE_TONE.fadeMs * sampleRate) / 1000);
  const env = i < fade ? 0.5 * (1 - Math.cos((Math.PI * i) / fade)) : i >= len - fade ? 0.5 * (1 - Math.cos((Math.PI * (len - 1 - i)) / fade)) : 1;
  return RETAKE_TONE.peak * env * Math.sin((2 * Math.PI * RETAKE_TONE.freqHz * i) / sampleRate);
}

/** Float (−1..1) → little-endian signed 24-bit PCM, clipped. */
export function floatToPcm24(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 3);
  for (let i = 0, o = 0; i < samples.length; i++, o += 3) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
    out[o] = v & 0xff;
    out[o + 1] = (v >> 8) & 0xff;
    out[o + 2] = (v >> 16) & 0xff;
  }
  return out;
}

export function pcm24ToFloat(bytes: Uint8Array): Float32Array {
  const n = Math.floor(bytes.length / 3);
  const out = new Float32Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 3) {
    let v = bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16);
    if (v & 0x800000) v |= ~0xffffff; // sign-extend
    out[i] = v < 0 ? v / 0x800000 : v / 0x7fffff;
  }
  return out;
}

export interface WavFormat {
  sampleRate: number;
  channels: number;
  bitDepth: number;
}

/** 44-byte RIFF/WAVE header for PCM with `dataBytes` of audio following it. */
export function wavHeader(f: WavFormat, dataBytes: number): Uint8Array {
  const h = new Uint8Array(44);
  const v = new DataView(h.buffer);
  const blockAlign = (f.channels * f.bitDepth) / 8;
  h.set([0x52, 0x49, 0x46, 0x46]); // RIFF
  v.setUint32(4, 36 + dataBytes, true);
  h.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8); // WAVEfmt␠
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, f.channels, true);
  v.setUint32(24, f.sampleRate, true);
  v.setUint32(28, f.sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, f.bitDepth, true);
  h.set([0x64, 0x61, 0x74, 0x61], 36); // data
  v.setUint32(40, dataBytes, true);
  return h;
}

export function parseWavHeader(b: Uint8Array): (WavFormat & { dataBytes: number; samples: number }) | null {
  if (b.length < 44) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt " || tag(36) !== "data" || v.getUint16(20, true) !== 1) return null;
  const channels = v.getUint16(22, true);
  const bitDepth = v.getUint16(34, true);
  const dataBytes = v.getUint32(40, true);
  return { sampleRate: v.getUint32(24, true), channels, bitDepth, dataBytes, samples: dataBytes / ((channels * bitDepth) / 8) };
}

/** Goertzel magnitude of `freq` over a window (relative amplitude 0..1 for a pure tone of that amplitude). */
export function goertzel(window: Float32Array, sampleRate: number, freq: number): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < window.length; i++) {
    const s = window[i]! + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return (2 * Math.sqrt(Math.max(0, power))) / window.length;
}

/**
 * Finds retake tones in captured audio: windows of 25 ms whose 1 kHz content is
 * strong (≥ 0.25 amplitude) and clearly dominant. Returns the start sample of each
 * tone. Used by tests now and by the retake-cleanup editor later.
 */
export function findRetakeTones(pcm: Float32Array, sampleRate: number): number[] {
  const win = Math.round(sampleRate * 0.025);
  const hop = Math.round(sampleRate * 0.005);
  const minGap = toneLength(sampleRate) * 2;
  const hits: number[] = [];
  let last = -Infinity;
  for (let at = 0; at + win <= pcm.length; at += hop) {
    const slice = pcm.subarray(at, at + win);
    const mag = goertzel(slice, sampleRate, RETAKE_TONE.freqHz);
    if (mag < 0.25) continue;
    let rms = 0;
    for (let i = 0; i < slice.length; i++) rms += slice[i]! * slice[i]!;
    rms = Math.sqrt(rms / slice.length);
    if (mag * 0.7071 < 0.6 * rms) continue; // 1 kHz must account for most of the energy
    if (at - last >= minGap) {
      // refine: walk back to where the tone actually begins
      let start = at;
      while (start - hop >= 0 && goertzel(pcm.subarray(start - hop, start - hop + win), sampleRate, RETAKE_TONE.freqHz) >= 0.25) start -= hop;
      hits.push(start);
    }
    last = at;
  }
  return hits;
}

export interface RetakeAnnotation {
  type: "retake";
  /** Capture-clock sample where the tone starts. */
  sample: number;
  /** Seconds into the recording (sample / sampleRate), for display. */
  atS: number;
}
