// Waveform peaks, computed once per recording and cached next to it. Level 0 holds the min and
// max of every 256 samples as signed bytes (−127..127), so 2 hours at 48 kHz is ≈ 2.7 MB — the
// browser fetches that, never the audio, to draw the timeline. Coarser zoom levels are derived
// from it in the browser (`reducePeaks`). Pure, so the server stream and the tests share it.

export const PEAK_SPP = 256;
const MAGIC = 0x314b5350; // "PSK1" little-endian
export const PEAK_HEADER_BYTES = 12;

/** Incrementally reads little-endian 24-bit PCM and emits min/max pairs per PEAK_SPP samples. */
export class PeakBuilder {
  private carry = new Uint8Array(0);
  private inBlock = 0;
  private min = 1;
  private max = -1;
  private out: number[] = [];
  samples = 0;

  push(bytes: Uint8Array): void {
    let buf = bytes;
    if (this.carry.length) {
      const joined = new Uint8Array(this.carry.length + bytes.length);
      joined.set(this.carry);
      joined.set(bytes, this.carry.length);
      buf = joined;
    }
    const whole = buf.length - (buf.length % 3);
    for (let i = 0; i < whole; i += 3) {
      let v = buf[i]! | (buf[i + 1]! << 8) | (buf[i + 2]! << 16);
      if (v & 0x800000) v -= 0x1000000;
      const f = v / 0x800000;
      if (f < this.min) this.min = f;
      if (f > this.max) this.max = f;
      this.samples++;
      if (++this.inBlock === PEAK_SPP) this.flush();
    }
    this.carry = buf.slice(whole);
  }

  private flush() {
    this.out.push(quant(this.min), quant(this.max));
    this.inBlock = 0;
    this.min = 1;
    this.max = -1;
  }

  /** Finish (the last partial block counts) and return the cache file bytes. */
  finish(): Uint8Array {
    if (this.inBlock > 0) this.flush();
    const pairs = this.out.length / 2;
    const file = new Uint8Array(PEAK_HEADER_BYTES + this.out.length);
    const dv = new DataView(file.buffer);
    dv.setUint32(0, MAGIC, true);
    dv.setUint32(4, PEAK_SPP, true);
    dv.setUint32(8, pairs, true);
    for (let i = 0; i < this.out.length; i++) dv.setInt8(PEAK_HEADER_BYTES + i, this.out[i]!);
    return file;
  }
}

const quant = (f: number) => Math.max(-127, Math.min(127, Math.round(f * 127)));

export interface Peaks {
  spp: number;
  /** Interleaved min,max in −1..1, one pair per `spp` samples. */
  data: Float32Array;
}

export function parsePeaks(file: Uint8Array): Peaks | null {
  if (file.length < PEAK_HEADER_BYTES) return null;
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) return null;
  const spp = dv.getUint32(4, true);
  const pairs = dv.getUint32(8, true);
  if (file.length !== PEAK_HEADER_BYTES + pairs * 2 || spp <= 0) return null;
  const data = new Float32Array(pairs * 2);
  for (let i = 0; i < data.length; i++) data[i] = dv.getInt8(PEAK_HEADER_BYTES + i) / 127;
  return { spp, data };
}

/** Min/max of source samples [from, to) from level-0 peaks (to the nearest block). */
export function rangePeak(p: Peaks, from: number, to: number): [number, number] {
  const a = Math.max(0, Math.floor(from / p.spp));
  const b = Math.min(p.data.length / 2, Math.max(a + 1, Math.ceil(to / p.spp)));
  let lo = 1;
  let hi = -1;
  for (let i = a; i < b; i++) {
    const mn = p.data[i * 2]!;
    const mx = p.data[i * 2 + 1]!;
    if (mn < lo) lo = mn;
    if (mx > hi) hi = mx;
  }
  return lo > hi ? [0, 0] : [lo, hi];
}
