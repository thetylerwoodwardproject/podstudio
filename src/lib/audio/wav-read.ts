/*
 * Reading WAV files: header, samples as floats, and channel remixing.
 */

export interface WavInfo {
  format: 'pcm' | 'float';
  channels: number;
  sampleRate: number;
  bitDepth: number;
  /** Byte offset and length of the samples */
  dataOffset: number;
  dataBytes: number;
}

/** Read a WAV header; null when the file isn't a WAV this can read directly. */
export function parseWav(head: DataView): WavInfo | null {
  const tag = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => head.getUint8(o + i)));
  if (head.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let o = 12;
  let fmt: Omit<WavInfo, 'dataOffset' | 'dataBytes'> | null = null;
  while (o + 8 <= head.byteLength) {
    const id = tag(o);
    const size = head.getUint32(o + 4, true);
    if (id === 'fmt ') {
      let code = head.getUint16(o + 8, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the sub-format GUID's first two bytes.
      if (code === 0xfffe && size >= 26) code = head.getUint16(o + 32, true);
      const bitDepth = head.getUint16(o + 22, true);
      const format = code === 1 ? 'pcm' : code === 3 ? 'float' : null;
      if (!format || (format === 'pcm' && ![16, 24, 32].includes(bitDepth)) || (format === 'float' && bitDepth !== 32)) return null;
      fmt = { format, channels: head.getUint16(o + 10, true), sampleRate: head.getUint32(o + 12, true), bitDepth };
    } else if (id === 'data') {
      return fmt ? { ...fmt, dataOffset: o + 8, dataBytes: size } : null;
    }
    o += 8 + size + (size % 2);
  }
  return null;
}

/** Interleaved samples from raw WAV bytes as floats. */
export function wavFloats(bytes: ArrayBuffer, info: WavInfo): Float32Array {
  const view = new DataView(bytes);
  const b = info.bitDepth / 8;
  const n = Math.floor(bytes.byteLength / b);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * b;
    if (info.format === 'float') out[i] = view.getFloat32(o, true);
    else if (b === 2) out[i] = view.getInt16(o, true) / 0x8000;
    else if (b === 3) out[i] = ((view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getInt8(o + 2) << 16)) / 0x800000);
    else out[i] = view.getInt32(o, true) / 0x80000000;
  }
  return out;
}

/** Interleaved samples with `from` channels as `to` channels (1 or 2). */
export function remix(samples: Float32Array, from: number, to: 1 | 2): Float32Array {
  const frames = Math.floor(samples.length / from);
  const out = new Float32Array(frames * to);
  for (let f = 0; f < frames; f++) {
    if (to === 2) {
      out[f * 2] = samples[f * from];
      out[f * 2 + 1] = samples[f * from + (from > 1 ? 1 : 0)];
    } else {
      // Mono from several channels: their average, so a stereo file can't clip.
      let s = 0;
      for (let c = 0; c < from; c++) s += samples[f * from + c];
      out[f] = s / from;
    }
  }
  return out;
}
