/*
 * Takes are stored in the browser's origin private file system (OPFS):
 *
 *   takes/<id>/meta.json
 *   takes/<id>/seg-000001.pcm   5 s of little-endian PCM at the take's bit depth
 *
 * Each segment is its own file, committed when written, so a crash or a
 * closed tab loses at most the last few seconds. While a take is recording,
 * its tab holds a Web Lock named after it; an unfinished take without a lock
 * is a crashed one and can be recovered.
 *
 * WAV downloads are assembled from the segment Files, which are disk-backed,
 * so even a long take never has to fit in memory.
 */

import { markerChunks, pcmBytes, tone, wavHeader, type BitDepth, type Marker } from './wav';

export interface TakeMeta {
  id: string;
  episodeId: string;
  number: number;
  name: string;
  kind: 'full' | 'punch-in';
  /** Zero-based script line the take starts on */
  startLine: number;
  startText: string;
  speaker: string;
  device: string;
  sampleRate: number;
  bitDepth: BitDepth;
  samples: number;
  segments: number;
  startedAt: number;
  updatedAt: number;
  status: 'recording' | 'done';
  /** Zero-based script line voice follow last placed the reader on */
  lastLine?: number;
  /** Peak level per half second, 0..1, for waveforms */
  peaks: number[];
}

const SEGMENT_SECONDS = 5;
const PEAK_SECONDS = 0.5;

async function takesDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('takes', { create: true });
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: BlobPart) {
  const file = await dir.getFileHandle(name, { create: true });
  const w = await file.createWritable();
  await w.write(data as FileSystemWriteChunkType);
  await w.close();
}

const segName = (n: number) => `seg-${String(n).padStart(6, '0')}.pcm`;
const lockName = (id: string) => `podstudio-take-${id}`;

export async function listTakes(episodeId?: string): Promise<TakeMeta[]> {
  const dir = await takesDir();
  const out: TakeMeta[] = [];
  for await (const [, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    if (handle.kind !== 'directory') continue;
    try {
      const file = await (handle as FileSystemDirectoryHandle).getFileHandle('meta.json');
      const meta = JSON.parse(await (await file.getFile()).text()) as TakeMeta;
      if (!episodeId || meta.episodeId === episodeId) out.push(meta);
    } catch {
      // A take directory without metadata is skipped.
    }
  }
  return out.sort((a, b) => a.number - b.number);
}

export async function getTake(id: string) {
  return (await listTakes()).find((t) => t.id === id) ?? null;
}

export async function deleteTake(id: string) {
  await (await takesDir()).removeEntry(id, { recursive: true });
}

/** Unfinished takes whose recording tab is gone (crash or closed tab). */
export async function findCrashedTakes(): Promise<TakeMeta[]> {
  const held = new Set(((await navigator.locks.query()).held ?? []).map((l) => l.name));
  return (await listTakes()).filter((t) => t.status === 'recording' && !held.has(lockName(t.id)));
}

/** Keep a recovered take: mark it done with whatever audio was saved. */
export async function markDone(meta: TakeMeta) {
  const dir = await (await takesDir()).getDirectoryHandle(meta.id);
  meta.status = 'done';
  await writeFile(dir, 'meta.json', JSON.stringify(meta));
}

/** The take's audio as raw PCM parts (disk-backed Files). */
async function pcmParts(meta: TakeMeta): Promise<File[]> {
  const dir = await (await takesDir()).getDirectoryHandle(meta.id);
  const files: File[] = [];
  for (let n = 1; n <= meta.segments; n++) {
    try {
      files.push(await (await dir.getFileHandle(segName(n))).getFile());
    } catch {
      break;
    }
  }
  return files;
}

export async function takeWav(meta: TakeMeta): Promise<Blob> {
  const parts = await pcmParts(meta);
  const bytes = parts.reduce((n, p) => n + p.size, 0);
  const samples = bytes / (meta.bitDepth / 8);
  const opts = { sampleRate: meta.sampleRate, bitDepth: meta.bitDepth };
  return new Blob([wavHeader(samples, opts) as BlobPart, ...parts, ...(bytes % 2 ? [new Uint8Array(1) as BlobPart] : [])], {
    type: 'audio/wav',
  });
}

export interface CombinedOptions {
  markers: boolean;
  tone: boolean;
}

/**
 * One WAV with every take back to back, optionally with a marker at each
 * take and a short tone between them. Takes must share a format.
 */
export async function combinedWav(takes: TakeMeta[], opts: CombinedOptions): Promise<{ blob: Blob; starts: number[] }> {
  const { sampleRate, bitDepth } = takes[0];
  const bytesPer = bitDepth / 8;
  const beep = opts.tone ? pcmBytes(tone(sampleRate), bitDepth) : null;
  const parts: BlobPart[] = [];
  const markers: Marker[] = [];
  const starts: number[] = [];
  let samples = 0;
  for (const [i, t] of takes.entries()) {
    if (i > 0 && beep) {
      parts.push(beep as BlobPart);
      samples += beep.length / bytesPer;
    }
    starts.push(samples);
    markers.push({ at: samples, label: t.kind === 'punch-in' ? `${t.name} · Punch-in L${t.startLine + 1}` : t.name });
    for (const p of await pcmParts(t)) {
      parts.push(p);
      samples += p.size / bytesPer;
    }
  }
  const tail = opts.markers ? markerChunks(markers) : new Uint8Array(0);
  const pad = (samples * bytesPer) % 2;
  const header = wavHeader(samples, { sampleRate, bitDepth }, tail.length);
  const blob = new Blob([header as BlobPart, ...parts, ...(pad ? [new Uint8Array(1) as BlobPart] : []), tail as BlobPart], {
    type: 'audio/wav',
  });
  return { blob, starts };
}

export const takeSeconds = (t: TakeMeta) => t.samples / t.sampleRate;

export function formatDuration(seconds: number) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** File name for a take, e.g. Ep142_Take3_L03_Four-I-counted.wav */
export function takeFileName(t: TakeMeta, episodeLabel = `Ep${t.episodeId}`) {
  const words = t.startText.split(/\s+/).slice(0, 3).join('-').replace(/[^\w-]/g, '');
  const line = t.kind === 'punch-in' ? `_L${String(t.startLine + 1).padStart(2, '0')}${words ? `_${words}` : ''}` : '';
  return `${episodeLabel}_Take${t.number}${line}.wav`;
}

/**
 * Writes one take as it records: collects samples and saves a segment every
 * five seconds. Call push() with each captured chunk and finish() at the end.
 */
export class TakeWriter {
  private pending: Float32Array[] = [];
  private pendingSamples = 0;
  private peakAcc = 0;
  private peakCount = 0;
  private writing: Promise<void> = Promise.resolve();
  private releaseLock!: () => void;
  private dir!: FileSystemDirectoryHandle;

  private constructor(readonly meta: TakeMeta) {}

  static async start(init: Omit<TakeMeta, 'id' | 'number' | 'name' | 'samples' | 'segments' | 'startedAt' | 'updatedAt' | 'status' | 'peaks'>) {
    // Ask Chrome not to evict takes when disk space runs low.
    await navigator.storage.persist?.().catch(() => false);
    const existing = await listTakes(init.episodeId);
    const number = existing.reduce((n, t) => Math.max(n, t.number), 0) + 1;
    const now = Date.now();
    const writer = new TakeWriter({
      ...init,
      id: `${init.episodeId}-${now.toString(36)}`,
      number,
      name: `Take ${number}`,
      samples: 0,
      segments: 0,
      startedAt: now,
      updatedAt: now,
      status: 'recording',
      peaks: [],
    });
    // Hold a lock for as long as this tab is recording the take.
    await new Promise<void>((locked) => {
      navigator.locks.request(lockName(writer.meta.id), () => {
        locked();
        return new Promise<void>((release) => (writer.releaseLock = release));
      });
    });
    writer.dir = await (await takesDir()).getDirectoryHandle(writer.meta.id, { create: true });
    await writeFile(writer.dir, 'meta.json', JSON.stringify(writer.meta));
    return writer;
  }

  get seconds() {
    return (this.meta.samples + this.pendingSamples) / this.meta.sampleRate;
  }

  push(samples: Float32Array) {
    this.pending.push(samples);
    this.pendingSamples += samples.length;
    const perPeak = this.meta.sampleRate * PEAK_SECONDS;
    for (let i = 0; i < samples.length; i++) {
      const a = Math.abs(samples[i]);
      if (a > this.peakAcc) this.peakAcc = a;
      if (++this.peakCount >= perPeak) {
        this.meta.peaks.push(Math.round(this.peakAcc * 1000) / 1000);
        this.peakAcc = 0;
        this.peakCount = 0;
      }
    }
    if (this.pendingSamples >= this.meta.sampleRate * SEGMENT_SECONDS) this.flush();
  }

  /** Save what has been captured so far as the next segment. */
  flush(): Promise<void> {
    const chunks = this.pending;
    const count = this.pendingSamples;
    this.pending = [];
    this.pendingSamples = 0;
    if (!count) return this.writing;
    this.writing = this.writing.then(async () => {
      const joined = new Float32Array(count);
      let o = 0;
      for (const c of chunks) {
        joined.set(c, o);
        o += c.length;
      }
      this.meta.segments += 1;
      await writeFile(this.dir, segName(this.meta.segments), pcmBytes(joined, this.meta.bitDepth) as BlobPart);
      this.meta.samples += count;
      this.meta.updatedAt = Date.now();
      await writeFile(this.dir, 'meta.json', JSON.stringify(this.meta));
    });
    return this.writing;
  }

  async finish(): Promise<TakeMeta> {
    await this.flush();
    this.meta.status = 'done';
    this.meta.updatedAt = Date.now();
    await writeFile(this.dir, 'meta.json', JSON.stringify(this.meta));
    this.releaseLock();
    return this.meta;
  }
}

/** Browser storage left for takes, and how much audio fits in it. */
export async function storageLeft(sampleRate: number, bitDepth: BitDepth) {
  const { quota = 0, usage = 0 } = await navigator.storage.estimate();
  const free = Math.max(0, quota - usage);
  return { free, hours: free / (sampleRate * (bitDepth / 8) * 3600) };
}

export function formatBytes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}
