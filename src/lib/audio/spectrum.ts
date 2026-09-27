/*
 * A voice's long-term spectrum: what it sounds like on average, for the Tone
 * card's "voice before" curve and Match to target. Up to ~300 windows of 4096
 * samples spread through the file (a Hann window and an FFT each); windows
 * that are nearly silent (pauses, room tone) are left out, so it's the voice
 * that's measured. The result is relative: 0 dB is the average over the speech
 * range (150 Hz – 6 kHz).
 */
import { WavReader } from './master.ts';
import type { Point } from '../graph.ts';

export { fft } from './fft.ts';
import { fft } from './fft.ts';

const SIZE = 4096;
const COLUMNS = 72; // about 1/7 octave from 20 Hz to 20 kHz

/** Average power per FFT bin of mono windows, skipping ones quieter than `gateDb` (RMS, dBFS). */
export class SpectrumAverage {
  private sum = new Float64Array(SIZE / 2);
  private hann = Float64Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (SIZE - 1)));
  count = 0;
  private gate: number;
  constructor(gateDb = -50) {
    this.gate = 10 ** (gateDb / 10);
  }
  add(mono: Float32Array | Float64Array) {
    let ms = 0;
    for (let i = 0; i < SIZE; i++) ms += mono[i] * mono[i];
    if (ms / SIZE < this.gate) return;
    const re = new Float64Array(SIZE), im = new Float64Array(SIZE);
    for (let i = 0; i < SIZE; i++) re[i] = mono[i] * this.hann[i];
    fft(re, im);
    for (let k = 1; k < SIZE / 2; k++) this.sum[k] += re[k] * re[k] + im[k] * im[k];
    this.count++;
  }
  /** Relative dB on a log axis (0 dB = the speech-range average), or [] if nothing was loud enough. */
  points(rate: number): Point[] {
    if (!this.count) return [];
    const sums = new Float64Array(COLUMNS), n = new Uint32Array(COLUMNS);
    const span = Math.log10(20000 / 20);
    for (let k = 1; k < SIZE / 2; k++) {
      const f = (k * rate) / SIZE;
      if (f < 20 || f > 20000) continue;
      const c = Math.min(COLUMNS - 1, Math.floor((Math.log10(f / 20) / span) * COLUMNS));
      sums[c] += this.sum[k];
      n[c]++;
    }
    const pts: Point[] = [];
    for (let c = 0; c < COLUMNS; c++) if (n[c]) pts.push([20 * 1000 ** ((c + 0.5) / COLUMNS), 10 * Math.log10(sums[c] / n[c] / this.count + 1e-20)]);
    const speech = pts.filter(([f]) => f >= 150 && f <= 6000);
    const mean = speech.reduce((s, p) => s + p[1], 0) / (speech.length || 1);
    return pts.map(([f, d]) => [f, d - mean]);
  }
}

/** A curve from points, for any frequency (log-linear between points). */
export function curveOf(points: Point[]): (f: number) => number {
  return (f) => {
    if (!points.length) return 0;
    if (f <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++)
      if (f <= points[i][0]) {
        const [f0, d0] = points[i - 1], [f1, d1] = points[i];
        return d0 + ((d1 - d0) * Math.log(f / f0)) / Math.log(f1 / f0);
      }
    return points[points.length - 1][1];
  };
}

/** The long-term spectrum of a WAV (a take or an edit). */
export async function longTermSpectrum(wav: Blob, windows = 300): Promise<Point[]> {
  const r = await WavReader.open(wav);
  const { channels, sampleRate } = r.info;
  const avg = new SpectrumAverage();
  const usable = r.frames - SIZE;
  if (usable <= 0) return [];
  const step = Math.max(SIZE, Math.floor(usable / windows));
  const mono = new Float64Array(SIZE);
  for (let at = 0; at < usable; at += step) {
    r.seek(at);
    const x = await r.read(SIZE);
    for (let i = 0; i < SIZE; i++) {
      let v = 0;
      for (let c = 0; c < channels; c++) v += x[i * channels + c] ?? 0;
      mono[i] = v / channels;
    }
    avg.add(mono);
  }
  return avg.points(sampleRate);
}

/** The spectrum of one window (4096 samples, mono) as absolute dB on the log axis, for a live curve. */
export function windowSpectrum(mono: Float32Array | Float64Array, rate: number): Point[] {
  const avg = new SpectrumAverage(-120);
  avg.add(mono);
  return avg.points(rate);
}
