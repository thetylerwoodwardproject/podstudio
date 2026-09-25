/*
 * Reads the samples out of the lossless PCM WebM that Chrome's MediaRecorder
 * writes ("audio/webm;codecs=pcm"), chunk by chunk as it arrives.
 *
 * Recording through MediaRecorder instead of Web Audio keeps the audio on the
 * microphone's own clock. A Web Audio graph runs on the output device's
 * clock, so with an interface in and other speakers out, Chrome has to drop
 * or repeat samples to keep up, which sounds like crackle or distortion.
 *
 * Only what's needed is parsed: the track's format, and the frames in
 * SimpleBlocks (or Blocks). Live WebM uses unknown-size Segment and Cluster
 * elements, so container elements are simply stepped into.
 */

export interface PcmFormat {
  sampleRate: number;
  channels: number;
  /** Bits per sample: 32 for float, 16/24/32 for integer */
  bitDepth: number;
  float: boolean;
}

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Cluster: 0x1f43b675,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  Audio: 0xe1,
  BlockGroup: 0xa0,
  CodecID: 0x86,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  BitDepth: 0x6264,
  SimpleBlock: 0xa3,
  Block: 0xa1,
};
/** Elements whose children are read; everything else is a leaf. */
const CONTAINERS = new Set([ID.Segment, ID.Cluster, ID.Tracks, ID.TrackEntry, ID.Audio, ID.BlockGroup]);

/** A variable-length integer at `o`: its value (marker bit removed) and length, or null if incomplete. */
function vint(b: Uint8Array, o: number, keepMarker = false): { value: number; length: number; unknown: boolean } | null {
  if (o >= b.length) return null;
  const first = b[o];
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8) throw new Error('Not a WebM file');
  if (o + length > b.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + b[o + i];
    if (b[o + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

export class WebmPcmReader {
  format: PcmFormat | null = null;
  private buf = new Uint8Array(0);
  private codec = '';
  private pending: Partial<PcmFormat> = {};

  /** Feed the next chunk; returns the interleaved samples it completed. */
  push(chunk: Uint8Array): Float32Array[] {
    const joined = new Uint8Array(this.buf.length + chunk.length);
    joined.set(this.buf);
    joined.set(chunk, this.buf.length);
    this.buf = joined;
    const out: Float32Array[] = [];
    let o = 0;
    for (;;) {
      const id = vint(this.buf, o, true);
      if (!id) break;
      const size = vint(this.buf, o + id.length);
      if (!size) break;
      const body = o + id.length + size.length;
      if (CONTAINERS.has(id.value) || size.unknown) {
        // Step inside: its children follow directly.
        o = body;
        continue;
      }
      if (body + size.value > this.buf.length) break; // wait for the rest
      const data = this.buf.subarray(body, body + size.value);
      this.leaf(id.value, data, out);
      o = body + size.value;
    }
    this.buf = this.buf.slice(o);
    return out;
  }

  private leaf(id: number, data: Uint8Array, out: Float32Array[]) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const uint = () => {
      let v = 0;
      for (const x of data) v = v * 256 + x;
      return v;
    };
    switch (id) {
      case ID.CodecID:
        this.codec = new TextDecoder().decode(data);
        break;
      case ID.SamplingFrequency:
        this.pending.sampleRate = Math.round(data.length === 4 ? view.getFloat32(0) : view.getFloat64(0));
        break;
      case ID.Channels:
        this.pending.channels = uint();
        break;
      case ID.BitDepth:
        this.pending.bitDepth = uint();
        break;
      case ID.SimpleBlock:
      case ID.Block:
        out.push(this.frames(data));
        break;
    }
  }

  private frames(block: Uint8Array): Float32Array {
    if (!this.format) {
      if (!this.codec.startsWith('A_PCM/')) throw new Error(`Expected PCM audio, got ${this.codec || 'no codec'}`);
      const float = this.codec === 'A_PCM/FLOAT/IEEE';
      this.format = {
        sampleRate: this.pending.sampleRate ?? 48000,
        channels: this.pending.channels ?? 1,
        bitDepth: this.pending.bitDepth ?? (float ? 32 : 16),
        float,
      };
    }
    // Track number, 16-bit timecode, flags; PCM blocks aren't laced.
    const track = vint(block, 0)!;
    const flags = block[track.length + 2];
    if (flags & 0x06) throw new Error('Laced PCM blocks are not supported');
    const pcm = block.subarray(track.length + 3);
    const { bitDepth, float } = this.format;
    const b = bitDepth / 8;
    const n = Math.floor(pcm.length / b);
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * b;
      if (float) out[i] = bitDepth === 64 ? view.getFloat64(o, true) : view.getFloat32(o, true);
      else if (b === 2) out[i] = view.getInt16(o, true) / 0x8000;
      else if (b === 3) out[i] = (pcm[o] | (pcm[o + 1] << 8) | ((pcm[o + 2] << 24) >> 8)) / 0x800000;
      else out[i] = view.getInt32(o, true) / 0x80000000;
    }
    return out;
  }
}

/** Frames from `channels` interleaved inputs as the recording wants them (see devices.ts). */
export function pickChannels(samples: Float32Array, inputs: number, channel: number | null, stereo: boolean): Float32Array {
  const frames = Math.floor(samples.length / inputs);
  if (stereo) {
    const out = new Float32Array(frames * 2);
    for (let f = 0; f < frames; f++) {
      out[f * 2] = samples[f * inputs];
      out[f * 2 + 1] = samples[f * inputs + (inputs > 1 ? 1 : 0)];
    }
    return out;
  }
  const out = new Float32Array(frames);
  if (channel !== null) {
    const c = Math.min(channel, inputs - 1);
    for (let f = 0; f < frames; f++) out[f] = samples[f * inputs + c];
  } else {
    // Averaged, like the meter's mix: it can't go past full scale.
    for (let f = 0; f < frames; f++) {
      let s = 0;
      for (let c = 0; c < inputs; c++) s += samples[f * inputs + c];
      out[f] = s / inputs;
    }
  }
  return out;
}
