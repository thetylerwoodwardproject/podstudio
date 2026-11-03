// Ported from the TWP social generator (tylerwoodward.me, src/lib/social/) so Podstudio's social
// previews are the same drawing. Changes from the original are limited to the `brand` hooks below
// (wordmark, domain, bar color, quote credit), so another show can use it.
// Turns an audio file into per-frame bar heights, computed once, so the preview and the export
// draw the exact same waveform and nothing depends on a live analyser.

export const FPS = 30;
export const BAR_COUNT = 24;

const FFT = 2048;

export async function decodeAudio(file: File): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(await file.arrayBuffer());
  } finally {
    void ctx.close();
  }
}

/** In-place radix-2 FFT. */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang),
      wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k,
          b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

/** Bar heights (0 to 1) for every video frame of the whole file: `frames * BAR_COUNT` values. */
export function analyse(buf: AudioBuffer): Float32Array {
  const frames = Math.max(1, Math.ceil(buf.duration * FPS));
  const sr = buf.sampleRate;
  const mono = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += d[i] / buf.numberOfChannels;
  }

  // Log-spaced bands from 60 Hz to 9 kHz, as bin ranges.
  const lo = 60,
    hi = Math.min(9000, sr / 2 - 1);
  const edges = Array.from({ length: BAR_COUNT + 1 }, (_, i) =>
    Math.round((lo * Math.pow(hi / lo, i / BAR_COUNT) * FFT) / sr),
  );
  for (let i = 1; i < edges.length; i++) edges[i] = Math.max(edges[i], edges[i - 1] + 1);

  const win = Float32Array.from(
    { length: FFT },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT),
  );
  const re = new Float32Array(FFT),
    im = new Float32Array(FFT);
  const db = new Float32Array(frames * BAR_COUNT);

  for (let f = 0; f < frames; f++) {
    const start = Math.round((f / FPS) * sr) - FFT / 2;
    for (let i = 0; i < FFT; i++) {
      const s = mono[start + i] ?? 0;
      re[i] = s * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < BAR_COUNT; b++) {
      let sum = 0;
      for (let k = edges[b]; k < edges[b + 1]; k++) sum += Math.hypot(re[k], im[k]);
      const mean = sum / (edges[b + 1] - edges[b]) / (FFT / 4);
      db[f * BAR_COUNT + b] = 20 * Math.log10(mean + 1e-6);
    }
  }

  // Normalise each band against its own range so quiet highs still move as much as loud lows.
  const out = new Float32Array(db.length);
  for (let b = 0; b < BAR_COUNT; b++) {
    const col = Float32Array.from({ length: frames }, (_, f) => db[f * BAR_COUNT + b]).sort();
    const floor = col[Math.floor(frames * 0.1)];
    const ceil = Math.max(col[Math.floor(frames * 0.97)], floor + 6);
    let s = 0;
    for (let f = 0; f < frames; f++) {
      const v = Math.min(1, Math.max(0, (db[f * BAR_COUNT + b] - floor) / (ceil - floor)));
      s += (v - s) * (v > s ? 0.7 : 0.25);
      out[f * BAR_COUNT + b] = 0.06 + 0.94 * s;
    }
  }
  return out;
}

/** The part of a decoded buffer between two times, as its own buffer for the encoder. */
export function slice(buf: AudioBuffer, from: number, to: number): AudioBuffer {
  const a = Math.max(0, Math.floor(from * buf.sampleRate));
  const b = Math.min(buf.length, Math.ceil(to * buf.sampleRate));
  const out = new AudioBuffer({
    length: Math.max(1, b - a),
    numberOfChannels: buf.numberOfChannels,
    sampleRate: buf.sampleRate,
  });
  for (let c = 0; c < buf.numberOfChannels; c++) {
    out.copyToChannel(buf.getChannelData(c).subarray(a, b), c);
  }
  return out;
}
