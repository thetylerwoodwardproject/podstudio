/*
 * MP3 of the ready-to-publish episode, for uploading to a podcast host:
 * 128 kbps mono or 192 kbps stereo, at the recording's rate, with an ID3 tag
 * (title, and Podstudio as the encoder). The encoder, LAME in JavaScript
 * (@breezystack/lamejs, LGPL-3.0), is loaded only when an MP3 is made.
 */
import { WavReader } from './master.ts';

/** ID3v2.3 tag with text frames. */
function id3(frames: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [id, text] of Object.entries(frames)) {
    const body = enc.encode(text);
    const f = new Uint8Array(10 + 1 + body.length);
    f.set(enc.encode(id), 0);
    new DataView(f.buffer).setUint32(4, 1 + body.length);
    f[10] = 3; // UTF-8
    f.set(body, 11);
    parts.push(f);
  }
  const size = parts.reduce((n, p) => n + p.length, 0);
  const tag = new Uint8Array(10 + size);
  tag.set(enc.encode('ID3'), 0);
  tag[3] = 3; // v2.3
  // Size as four 7-bit bytes.
  tag[6] = (size >> 21) & 0x7f;
  tag[7] = (size >> 14) & 0x7f;
  tag[8] = (size >> 7) & 0x7f;
  tag[9] = size & 0x7f;
  let o = 10;
  for (const p of parts) {
    tag.set(p, o);
    o += p.length;
  }
  return tag;
}

const toInt16 = (x: Float32Array, ch: number, c: number) => {
  const out = new Int16Array(x.length / ch);
  for (let i = 0; i < out.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i * ch + c]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
};

export async function encodeMp3(wav: Blob, title: string, onProgress?: (done: number) => void): Promise<Blob> {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const r = await WavReader.open(wav);
  const { sampleRate, channels } = r.info;
  const enc = new Mp3Encoder(channels, sampleRate, channels === 2 ? 192 : 128);
  const parts: BlobPart[] = [id3({ TIT2: title, TSSE: 'Podstudio' }) as BlobPart];
  const chunk = 1152 * 40;
  let done = 0;
  for (let x = await r.read(chunk); x.length; x = await r.read(chunk)) {
    const l = toInt16(x, channels, 0);
    const out = channels === 2 ? enc.encodeBuffer(l, toInt16(x, channels, 1)) : enc.encodeBuffer(l);
    if (out.length) parts.push(out.slice() as BlobPart);
    done += l.length;
    onProgress?.(done / r.frames);
    // Let the page breathe between chunks.
    if ((done / chunk) % 20 === 0) await new Promise((res) => setTimeout(res));
  }
  const tail = enc.flush();
  if (tail.length) parts.push(tail.slice() as BlobPart);
  return new Blob(parts, { type: 'audio/mpeg' });
}
