// Waveform peaks, computed once per recording and cached next to it. Level 0 holds the min and
// max of every 256 samples as signed bytes (−127..127), so 2 hours at 48 kHz is ≈ 2.7 MB — the
// browser fetches that, never the audio, to draw the timeline. Coarser zoom levels are derived
// from it in the browser (`reducePeaks`). Pure, so the server stream and the tests share it.

export const PEAK_SPP = 256;
const MAGIC = 0x314b5350; // "PSK1" little-endian: mono
const MAGIC2 = 0x324b5350; // "PSK2": stereo — a 16-byte header (+ channel count), then all L pairs, then all R pairs
export const PEAK_HEADER_BYTES = 12;

/** Incrementally reads little-endian 24-bit PCM (1 or 2 interleaved channels) and emits min/max pairs per PEAK_SPP frames, per channel. */
export class PeakBuilder {
  private carry = new Uint8Array(0);
  private inBlock = 0;
  private min: number[];
  private max: number[];
  private out: number[][];
  samples = 0;

  constructor(readonly channels: 1 | 2 = 1) {
    this.min = Array(channels).fill(1);
    this.max = Array(channels).fill(-1);
    this.out = Array.from({ length: channels }, () => []);
  }

  push(bytes: Uint8Array): void {
    let buf = bytes;
    if (this.carry.length) {
      const joined = new Uint8Array(this.carry.length + bytes.length);
      joined.set(this.carry);
      joined.set(bytes, this.carry.length);
      buf = joined;
    }
    const fb = 3 * this.channels;
    const whole = buf.length - (buf.length % fb);
    for (let i = 0; i < whole; i += fb) {
      for (let c = 0; c < this.channels; c++) {
        const o = i + 3 * c;
        let v = buf[o]! | (buf[o + 1]! << 8) | (buf[o + 2]! << 16);
        if (v & 0x800000) v -= 0x1000000;
        const f = v / 0x800000;
        if (f < this.min[c]!) this.min[c] = f;
        if (f > this.max[c]!) this.max[c] = f;
      }
      this.samples++;
      if (++this.inBlock === PEAK_SPP) this.flush();
    }
    this.carry = buf.slice(whole);
  }

  private flush() {
    for (let c = 0; c < this.channels; c++) {
      this.out[c]!.push(quant(this.min[c]!), quant(this.max[c]!));
      this.min[c] = 1;
      this.max[c] = -1;
    }
    this.inBlock = 0;
  }

  /** Finish (the last partial block counts) and return the cache file bytes. */
  finish(): Uint8Array {
    if (this.inBlock > 0) this.flush();
    const pairs = this.out[0]!.length / 2;
    const head = this.channels === 2 ? 16 : PEAK_HEADER_BYTES;
    const file = new Uint8Array(head + pairs * 2 * this.channels);
    const dv = new DataView(file.buffer);
    dv.setUint32(0, this.channels === 2 ? MAGIC2 : MAGIC, true);
    dv.setUint32(4, PEAK_SPP, true);
    dv.setUint32(8, pairs, true);
    if (this.channels === 2) dv.setUint32(12, 2, true);
    let o = head;
    for (const ch of this.out) for (const v of ch) dv.setInt8(o++, v);
    return file;
  }
}

const quant = (f: number) => Math.max(-127, Math.min(127, Math.round(f * 127)));

export interface Peaks {
  spp: number;
  /** Interleaved min,max in −1..1, one pair per `spp` samples (the left channel of a stereo source). */
  data: Float32Array;
  /** Right channel, for a stereo source. */
  data2?: Float32Array;
}

export function parsePeaks(file: Uint8Array): Peaks | null {
  if (file.length < PEAK_HEADER_BYTES) return null;
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const magic = dv.getUint32(0, true);
  if (magic !== MAGIC && magic !== MAGIC2) return null;
  const stereo = magic === MAGIC2;
  const head = stereo ? 16 : PEAK_HEADER_BYTES;
  const spp = dv.getUint32(4, true);
  const pairs = dv.getUint32(8, true);
  if (stereo && (file.length < 16 || dv.getUint32(12, true) !== 2)) return null;
  if (file.length !== head + pairs * 2 * (stereo ? 2 : 1) || spp <= 0) return null;
  const read = (o: number) => {
    const d = new Float32Array(pairs * 2);
    for (let i = 0; i < d.length; i++) d[i] = dv.getInt8(o + i) / 127;
    return d;
  };
  return stereo ? { spp, data: read(head), data2: read(head + pairs * 2) } : { spp, data: read(head) };
}

/** Min/max of source samples [from, to) from level-0 peaks (to the nearest block). */
export function rangePeak(p: Peaks, from: number, to: number, channel: 0 | 1 = 0): [number, number] {
  const data = channel === 1 && p.data2 ? p.data2 : p.data;
  const a = Math.max(0, Math.floor(from / p.spp));
  const b = Math.min(data.length / 2, Math.max(a + 1, Math.ceil(to / p.spp)));
  let lo = 1;
  let hi = -1;
  for (let i = a; i < b; i++) {
    const mn = data[i * 2]!;
    const mx = data[i * 2 + 1]!;
    if (mn < lo) lo = mn;
    if (mx > hi) hi = mx;
  }
  return lo > hi ? [0, 0] : [lo, hi];
}
