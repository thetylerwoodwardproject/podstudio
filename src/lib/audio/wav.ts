/*
 * PCM WAV encoding, mono or stereo, 16 or 24-bit. Stereo samples are
 * interleaved (L R L R …). Takes float samples in chunks so a
 * long take never needs one giant buffer: each chunk becomes one Blob part.
 * Optional cue markers (cue + LIST/adtl/labl) are read by Reaper, Audition,
 * Pro Tools and Logic. An optional Broadcast WAV (bext) chunk carries the
 * file's start as timecode, so editors can line tracks up by it.
 */
import { bextChunk, type Bext } from './sync.ts';

export type BitDepth = 16 | 24;

export type Channels = 1 | 2;

export interface Marker {
  /** Position in sample frames from the start of the file */
  at: number;
  label: string;
}

export interface WavOptions {
  sampleRate: number;
  bitDepth: BitDepth;
  /** 1 (mono, the default) or 2 (stereo, interleaved) */
  channels?: Channels;
  markers?: Marker[];
  /** Broadcast WAV timecode: where this file starts */
  bext?: Bext;
}

const ascii = (view: DataView, offset: number, text: string) => {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
};

/** Convert float samples (-1..1) to little-endian PCM bytes. */
export function pcmBytes(samples: Float32Array, bitDepth: BitDepth): Uint8Array {
  const bytes = bitDepth / 8;
  const out = new Uint8Array(samples.length * bytes);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    if (bitDepth === 16) {
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    } else {
      const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
      out[i * 3] = v & 0xff;
      out[i * 3 + 1] = (v >> 8) & 0xff;
      out[i * 3 + 2] = (v >> 16) & 0xff;
    }
  }
  return out;
}

/** Little-endian PCM bytes back to float samples (the inverse of pcmBytes). */
export function pcmFloats(bytes: Uint8Array, bitDepth: BitDepth): Float32Array {
  const b = bitDepth / 8;
  const n = Math.floor(bytes.length / b);
  const out = new Float32Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < n; i++) {
    if (bitDepth === 16) {
      const v = view.getInt16(i * 2, true);
      out[i] = v < 0 ? v / 0x8000 : v / 0x7fff;
    } else {
      const v = (bytes[i * 3] | (bytes[i * 3 + 1] << 8) | ((bytes[i * 3 + 2] << 24) >> 8));
      out[i] = v < 0 ? v / 0x800000 : v / 0x7fffff;
    }
  }
  return out;
}

/** cue + LIST/adtl chunks for markers; empty when there are none. */
export function markerChunks(markers: Marker[]): Uint8Array {
  if (!markers.length) return new Uint8Array(0);
  const enc = new TextEncoder();
  const labels = markers.map((m) => enc.encode(m.label + '\0'));
  const cueSize = 4 + markers.length * 24;
  const lablSizes = labels.map((l) => 4 + l.length);
  const adtlSize = 4 + lablSizes.reduce((n, s) => n + 8 + s + (s % 2), 0);
  const out = new Uint8Array(8 + cueSize + 8 + adtlSize);
  const view = new DataView(out.buffer);

  ascii(view, 0, 'cue ');
  view.setUint32(4, cueSize, true);
  view.setUint32(8, markers.length, true);
  markers.forEach((m, i) => {
    const o = 12 + i * 24;
    view.setUint32(o, i + 1, true); // cue id
    view.setUint32(o + 4, m.at, true); // play order position
    ascii(view, o + 8, 'data');
    view.setUint32(o + 12, 0, true); // chunk start
    view.setUint32(o + 16, 0, true); // block start
    view.setUint32(o + 20, m.at, true); // sample offset
  });

  let o = 8 + cueSize;
  ascii(view, o, 'LIST');
  view.setUint32(o + 4, adtlSize, true);
  ascii(view, o + 8, 'adtl');
  o += 12;
  labels.forEach((label, i) => {
    ascii(view, o, 'labl');
    view.setUint32(o + 4, lablSizes[i], true);
    view.setUint32(o + 8, i + 1, true);
    out.set(label, o + 12);
    o += 8 + lablSizes[i] + (lablSizes[i] % 2);
  });
  return out;
}

/** RIFF + fmt + data headers for `frames` sample frames (one sample per channel). */
export function wavHeader(frames: number, { sampleRate, bitDepth, channels = 1, bext }: WavOptions, trailingBytes = 0): Uint8Array {
  const blockAlign = (bitDepth / 8) * channels;
  const dataSize = frames * blockAlign;
  const pad = dataSize % 2;
  // RIFF, fmt, then bext (if any) before the audio, where every reader looks for it.
  const ext = bext ? bextChunk(bext) : new Uint8Array(0);
  const out = new Uint8Array(44 + ext.length);
  const view = new DataView(out.buffer);
  ascii(view, 0, 'RIFF');
  view.setUint32(4, 36 + ext.length + dataSize + pad + trailingBytes, true);
  ascii(view, 8, 'WAVE');
  ascii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  out.set(ext, 36);
  ascii(view, 36 + ext.length, 'data');
  view.setUint32(40 + ext.length, dataSize, true);
  return out;
}

/** Build a WAV Blob from float chunks (interleaved when stereo). */
export function encodeWav(chunks: Float32Array[], opts: WavOptions): Blob {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  const markers = markerChunks(opts.markers ?? []);
  const pad = (samples * (opts.bitDepth / 8)) % 2;
  const parts: BlobPart[] = [wavHeader(samples / (opts.channels ?? 1), opts, markers.length) as BlobPart];
  for (const c of chunks) parts.push(pcmBytes(c, opts.bitDepth) as BlobPart);
  if (pad) parts.push(new Uint8Array(1) as BlobPart);
  if (markers.length) parts.push(markers as BlobPart);
  return new Blob(parts, { type: 'audio/wav' });
}

/** Sine tone for marking joins between takes: 1 kHz at -20 dBFS for 0.5 s by default. */
export function tone(
  sampleRate: number,
  { freq = 1000, dbfs = -20, seconds = 0.5, channels = 1 as Channels } = {},
): Float32Array {
  const amp = 10 ** (dbfs / 20);
  const n = Math.round(sampleRate * seconds);
  const out = new Float32Array(n * channels);
  const fade = Math.min(n / 2, Math.round(sampleRate * 0.005)); // 5 ms ramps avoid clicks
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / fade, (n - 1 - i) / fade);
    out.fill(amp * env * Math.sin((2 * Math.PI * freq * i) / sampleRate), i * channels, (i + 1) * channels);
  }
  return out;
}

/** Bytes per second of audio at this format. */
export const bytesPerSecond = (sampleRate: number, bitDepth: BitDepth, channels: Channels = 1) =>
  sampleRate * (bitDepth / 8) * channels;
