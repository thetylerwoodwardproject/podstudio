/*
 * Takes are stored in the browser's origin private file system (OPFS):
 *
 *   takes/<id>/meta.json
 *   takes/<id>/seg-000001.pcm   5 s of little-endian PCM at the take's bit depth
 *                              (interleaved L R when the take is stereo)
 *
 * Each segment is its own file, committed when written, so a crash or a
 * closed tab loses at most the last few seconds. While a take is recording,
 * its tab holds a Web Lock named after it; an unfinished take without a lock
 * is a crashed one and can be recovered.
 *
 * WAV downloads are assembled from the segment Files, which are disk-backed,
 * so even a long take never has to fit in memory.
 *
 * Processed copies (noise suppression) sit beside the original in their own
 * folder, `takes/<id>/<variant>/seg-*.pcm`, with a `done` file once complete.
 * The original segments are never changed.
 */

import { SILENT, fitClock, startTime, syncGuest, type Bext, type SyncLog, type SyncMap, type SyncPoint } from './sync';
import { markerChunks, pcmBytes, pcmFloats, wavHeader, type BitDepth, type Channels, type Marker } from './wav';
import type { LineStart, Range, SessionMarker } from './assemble';
import { mixTones, toneWindows, type PlacedTone, type ToneSettings } from './tones';
import type { PadLog } from './pads-render';
import { MUTE_FADE, applyMute, splitByMutes } from './mute';

export interface TakeMeta {
  id: string;
  episodeId: string;
  number: number;
  name: string;
  /** 'session' is a continuous recording with retakes and pauses as markers */
  kind: 'full' | 'punch-in' | 'session';
  /** Zero-based script line the take starts on */
  startLine: number;
  startText: string;
  speaker: string;
  device: string;
  sampleRate: number;
  bitDepth: BitDepth;
  /** 2 for stereo; takes saved before stereo existed have none and are mono */
  channels?: Channels;
  /** Sample frames recorded (one sample per channel) */
  samples: number;
  segments: number;
  startedAt: number;
  updatedAt: number;
  status: 'recording' | 'done';
  /** Zero-based script line voice follow last placed the reader on */
  lastLine?: number;
  /** Continuous sessions: an id per session */
  group?: string;
  /** Continuous sessions: retakes, cuts, pauses, ad-libs and gaps, on the wall clock */
  markers?: SessionMarker[];
  /** Continuous sessions: when each script line was reached */
  lineLog?: LineStart[];
  /** Server clock (ms) when this track's recorder started, for lining up tracks from different devices */
  startedAtServer?: number;
  /** A guest's track moved by hand against the host's, ms, later (+) or earlier (−), after sync (Wrapping up → Line up) */
  nudgeMs?: number;
  /** Sync points (frames captured, shared-clock ms), about every 5 s: drift and gap correction, timecode (lib/audio/sync.ts) */
  sync?: SyncLog;
  /** Recorded on another device (the guest's), fetched from the server */
  remote?: boolean;
  /** The host's take in a session with a guest: whose track export has to wait for */
  guest?: { name: string; sessionId: string };
  /** Voice follow restarts, errors and stalls during the session, for diagnosing */
  voiceLog?: { t: number; at: string; event: string; detail?: string }[];
  /** Hotkey pads pressed during the session, to rebuild the Pads track at export */
  pads?: PadLog;
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
  if (!('createWritable' in FileSystemFileHandle.prototype)) return writeInWorker(dir, name, data);
  const file = await dir.getFileHandle(name, { create: true });
  const w = await file.createWritable();
  await w.write(data as FileSystemWriteChunkType);
  await w.close();
}

// Safari before 26 has no createWritable(): it can only write from a worker, with a sync handle.
let writer: Worker | null = null;
let nextWrite = 1;
const writes = new Map<number, [() => void, (e: Error) => void]>();
async function writeInWorker(dir: FileSystemDirectoryHandle, name: string, data: BlobPart) {
  if (!writer) {
    writer = new Worker(new URL('./opfs-write.worker.ts', import.meta.url), { type: 'module' });
    writer.onmessage = (e: MessageEvent<{ id: number; error?: string }>) => {
      const w = writes.get(e.data.id);
      writes.delete(e.data.id);
      if (e.data.error) w?.[1](new Error(e.data.error));
      else w?.[0]();
    };
  }
  const path = (await (await navigator.storage.getDirectory()).resolve(dir)) ?? [];
  const bytes = await new Blob([data]).arrayBuffer();
  const id = nextWrite++;
  await new Promise<void>((resolve, reject) => {
    writes.set(id, [resolve, reject]);
    writer!.postMessage({ id, path, name, data: bytes }, [bytes]);
  });
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

/** Save changes to a take's details (meta.json), such as a guest's nudge. */
export async function updateMeta(meta: TakeMeta) {
  const dir = await (await takesDir()).getDirectoryHandle(meta.id);
  meta.updatedAt = Date.now();
  await writeFile(dir, 'meta.json', JSON.stringify(meta));
}

/** Keep a recovered take: mark it done with whatever audio was saved. */
export async function markDone(meta: TakeMeta) {
  const dir = await (await takesDir()).getDirectoryHandle(meta.id);
  meta.status = 'done';
  await writeFile(dir, 'meta.json', JSON.stringify(meta));
}

/** The take's audio as raw PCM parts (disk-backed Files). */
const channelsOf = (t: TakeMeta): Channels => t.channels ?? 1;
/** Bytes per sample frame */
const frameBytes = (t: TakeMeta) => (t.bitDepth / 8) * channelsOf(t);
const formatOf = (t: TakeMeta) => ({ sampleRate: t.sampleRate, bitDepth: t.bitDepth, channels: channelsOf(t) });

async function pcmParts(meta: TakeMeta, variant?: string): Promise<File[]> {
  let dir = await (await takesDir()).getDirectoryHandle(meta.id);
  if (variant) dir = await dir.getDirectoryHandle(variant);
  const files: File[] = [];
  for (let n = 1; variant || n <= meta.segments; n++) {
    try {
      files.push(await (await dir.getFileHandle(segName(n))).getFile());
    } catch {
      break;
    }
  }
  return files;
}

/**
 * WAV made of the given time ranges (seconds) of a take, joined in order.
 * Slices the disk-backed segment files, so nothing large is copied. Stretches
 * in `muted` (seconds of the take, e.g. coughs) come out silent, with a short
 * fade at each edge; only those are decoded and re-encoded.
 */
export async function rangesWav(
  meta: TakeMeta,
  ranges: Range[],
  markers: Marker[] = [],
  variant?: string,
  muted: Range[] = [],
  /** Timecode; by default where the first range starts on this track */
  bext: Bext | null = bextFor(meta, trackStart(meta) + (ranges[0] && ranges[0][0] < SILENT ? Math.max(0, ranges[0][0]) : 0) * 1000),
): Promise<Blob> {
  const bytesPer = frameBytes(meta);
  const channels = channelsOf(meta);
  const files = await pcmParts(meta, variant);
  const offsets: number[] = [];
  let total = 0;
  for (const f of files) {
    offsets.push(total);
    total += f.size;
  }
  const totalFrames = total / bytesPer;
  const parts: BlobPart[] = [];
  let bytes = 0;
  // Stretches before the take starts or after it ends come out as silence, so a track
  // from another device can be lined up with the host's (see alignedRanges).
  const silence = (n: number) => {
    if (n <= 0) return;
    parts.push(new Uint8Array(n));
    bytes += n;
  };
  const slice = (fa: number, fb: number) => {
    silence(Math.min(fb, 0) - fa);
    const from = Math.min(total, Math.max(0, fa));
    const to = Math.min(total, Math.max(0, fb));
    files.forEach((f, i) => {
      const start = Math.max(from, offsets[i]);
      const end = Math.min(to, offsets[i] + f.size);
      if (end > start) {
        parts.push(f.slice(start - offsets[i], end - offsets[i]));
        bytes += end - start;
      }
    });
    silence(fb - Math.max(total, fa));
  };
  const rate = meta.sampleRate;
  const fade = Math.round(MUTE_FADE * rate);
  const mutedFrames = muted.map(([a, b]) => [Math.round(a * rate), Math.round(b * rate)] as [number, number]);
  for (const [a, b] of ranges) {
    const ra = Math.round(a * rate);
    const rb = Math.round(b * rate);
    for (const piece of splitByMutes(ra, rb, mutedFrames)) {
      if (!piece.muted) {
        slice(piece.a * bytesPer, piece.b * bytesPer);
        continue;
      }
      // Muted: the audio that exists is decoded, faded out and in, and re-encoded.
      const from = Math.max(0, piece.a);
      const to = Math.min(totalFrames, piece.b);
      silence((Math.min(piece.b, 0) - piece.a) * bytesPer);
      if (to > from) {
        const [ma, mb] = mutedFrames.find(([x, y]) => x <= piece.a && y >= piece.b) ?? [piece.a, piece.b];
        const x = applyMute(await readFrames(meta, from, to - from, variant), channels, from, ma, mb, fade);
        const pcm = pcmBytes(x, meta.bitDepth);
        parts.push(pcm as BlobPart);
        bytes += pcm.length;
      }
      silence((piece.b - Math.max(totalFrames, piece.a)) * bytesPer);
    }
  }
  const tail = markerChunks(markers);
  const header = wavHeader(bytes / bytesPer, { ...formatOf(meta), bext: bext ?? undefined }, tail.length);
  return new Blob([header as BlobPart, ...parts, ...(bytes % 2 ? [new Uint8Array(1) as BlobPart] : []), tail as BlobPart], {
    type: 'audio/wav',
  });
}

/** Byte range [from, to) of the take's audio, as slices of its segment files. */
function sliceParts(files: File[], from: number, to: number): BlobPart[] {
  const parts: BlobPart[] = [];
  let offset = 0;
  for (const f of files) {
    const a = Math.max(from, offset);
    const b = Math.min(to, offset + f.size);
    if (b > a) parts.push(f.slice(a - offset, b - offset));
    offset += f.size;
  }
  return parts;
}

/**
 * The whole take with marker tones mixed in (ducked under the voice). Only the
 * short stretches around the tones are decoded and re-encoded; the rest is
 * sliced straight from the saved segments.
 */
export async function tonedWav(meta: TakeMeta, tones: PlacedTone[], opts: ToneSettings, markers: Marker[] = [], variant?: string, bext: Bext | null = bextFor(meta)): Promise<Blob> {
  const bytesPer = frameBytes(meta);
  const files = await pcmParts(meta, variant);
  const total = files.reduce((n, f) => n + f.size, 0);
  const frames = Math.floor(total / bytesPer);
  const channels = channelsOf(meta);
  const parts: BlobPart[] = [];
  let at = 0;
  for (const w of toneWindows(tones, meta.sampleRate, frames)) {
    parts.push(...sliceParts(files, at * bytesPer, w.from * bytesPer));
    const x = await readFrames(meta, w.from, w.to - w.from, variant);
    parts.push(pcmBytes(mixTones(x, channels, meta.sampleRate, w.from, w.tones, opts), meta.bitDepth) as BlobPart);
    at = w.to;
  }
  parts.push(...sliceParts(files, at * bytesPer, frames * bytesPer));
  const bytes = frames * bytesPer;
  const tail = markerChunks(markers);
  const header = wavHeader(frames, { ...formatOf(meta), bext: bext ?? undefined }, tail.length);
  return new Blob([header as BlobPart, ...parts, ...(bytes % 2 ? [new Uint8Array(1) as BlobPart] : []), tail as BlobPart], { type: 'audio/wav' });
}

/**
 * How far (seconds) a track from another device started after the host's, from
 * their server-clock start times: positive when the guest started later.
 */
export function trackShift(track: TakeMeta, host: TakeMeta): number {
  if (track === host || track.startedAtServer == null || host.startedAtServer == null) return 0;
  return (track.startedAtServer - host.startedAtServer) / 1000;
}

/** The track's clock, fitted from its sync points (lib/audio/sync.ts). */
export const trackClock = (t: TakeMeta) => fitClock(t.sync?.points ?? [], t.sampleRate, t.samples, t.startedAtServer ?? t.startedAt);

/** When the track's first frame was captured, ms on its clock (the session's shared clock with a guest). */
export const trackStart = (t: TakeMeta) => startTime(trackClock(t));

/**
 * How a guest's track maps onto the host's, with drift and gaps accounted for,
 * or null for tracks without shared-clock sync points (from before they
 * existed): those are lined up by their start times only (trackShift).
 */
export function trackSync(guest: TakeMeta, host: TakeMeta): SyncMap | null {
  const ok = (t: TakeMeta) => t.sync?.clock === 'server' && t.sync.points.length >= 3;
  return ok(guest) && ok(host) ? syncGuest(trackClock(host), trackClock(guest), host.sampleRate) : null;
}

/** Broadcast WAV timecode for a file of this track starting at `start` (ms). */
export const bextFor = (t: TakeMeta, start = trackStart(t)): Bext => ({
  description: `Podstudio · ${t.speaker} · ${t.name}`,
  originator: 'Podstudio',
  reference: t.id.slice(0, 32),
  start,
  sampleRate: t.sampleRate,
});

export async function takeWav(meta: TakeMeta, variant?: string, bext: Bext | null = bextFor(meta)): Promise<Blob> {
  const parts = await pcmParts(meta, variant);
  const bytes = parts.reduce((n, p) => n + p.size, 0);
  return new Blob([wavHeader(bytes / frameBytes(meta), { ...formatOf(meta), bext: bext ?? undefined }) as BlobPart, ...parts, ...(bytes % 2 ? [new Uint8Array(1) as BlobPart] : [])], {
    type: 'audio/wav',
  });
}

/** One saved segment (1-based) of a take, as a disk-backed File. */
export async function segmentFile(meta: TakeMeta, n: number): Promise<File> {
  const dir = await (await takesDir()).getDirectoryHandle(meta.id);
  return (await dir.getFileHandle(segName(n))).getFile();
}

/**
 * Save a take recorded elsewhere (the guest's, from the server) into this
 * browser, segment by segment, so it exports like any other track.
 */
export async function saveRemoteTake(meta: TakeMeta, fetchSegment: (n: number) => Promise<ArrayBuffer>, onProgress?: (n: number) => void) {
  const dir = await (await takesDir()).getDirectoryHandle(meta.id, { create: true });
  let samples = 0;
  for (let n = 1; n <= meta.segments; n++) {
    const data = await fetchSegment(n);
    await writeFile(dir, segName(n), data);
    samples += data.byteLength / frameBytes(meta);
    onProgress?.(n);
  }
  meta.samples = samples;
  meta.status = 'done';
  await writeFile(dir, 'meta.json', JSON.stringify(meta));
  return meta;
}

/** `count` frames from frame `from` onward, as float samples (interleaved when stereo). */
export async function readFrames(meta: TakeMeta, from: number, count: number, variant?: string): Promise<Float32Array> {
  const bytesPer = frameBytes(meta);
  const start = from * bytesPer;
  const end = (from + count) * bytesPer;
  const slices: Blob[] = [];
  let offset = 0;
  for (const f of await pcmParts(meta, variant)) {
    const a = Math.max(start, offset);
    const b = Math.min(end, offset + f.size);
    if (b > a) slices.push(f.slice(a - offset, b - offset));
    offset += f.size;
    if (offset >= end) break;
  }
  return pcmFloats(new Uint8Array(await new Blob(slices).arrayBuffer()), meta.bitDepth);
}

/** Whether a finished processed copy of the take exists. */
export async function hasVariant(meta: TakeMeta, variant: string): Promise<boolean> {
  try {
    const dir = await (await (await takesDir()).getDirectoryHandle(meta.id)).getDirectoryHandle(variant);
    await dir.getFileHandle('done');
    return true;
  } catch {
    return false;
  }
}

/** Writes a processed copy of a take, in the take's own format, beside the original. */
export class VariantWriter {
  private n = 0;
  private dir: FileSystemDirectoryHandle;
  private meta: TakeMeta;

  private constructor(meta: TakeMeta, dir: FileSystemDirectoryHandle) {
    this.meta = meta;
    this.dir = dir;
  }

  static async open(meta: TakeMeta, variant: string) {
    const take = await (await takesDir()).getDirectoryHandle(meta.id);
    // Start clean: an interrupted run leaves a partial copy.
    await take.removeEntry(variant, { recursive: true }).catch(() => {});
    return new VariantWriter(meta, await take.getDirectoryHandle(variant, { create: true }));
  }

  async write(samples: Float32Array) {
    if (!samples.length) return;
    this.n += 1;
    await writeFile(this.dir, segName(this.n), pcmBytes(samples, this.meta.bitDepth) as BlobPart);
  }

  async done() {
    await writeFile(this.dir, 'done', '');
  }
}

export const takeSeconds = (t: TakeMeta) => t.samples / t.sampleRate;
/** Size of the take's audio in bytes */
export const takeBytes = (t: TakeMeta) => t.samples * frameBytes(t);

export function formatDuration(seconds: number) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** File name for a recording, e.g. Ep142_Session_Tyler_2026-09-24-1930.wav (older takes: Ep142_Take3.wav) */
export function takeFileName(t: TakeMeta, episodeLabel = `Ep${t.episodeId}`) {
  if (t.kind === 'session') {
    const d = new Date(t.startedAt);
    const p = (n: number) => String(n).padStart(2, '0');
    const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    return `${episodeLabel}_Session_${t.speaker.charAt(0)}${t.speaker.slice(1).toLowerCase()}_${when}.wav`;
  }
  const words = t.startText.split(/\s+/).slice(0, 3).join('-').replace(/[^\w-]/g, '');
  const line = t.kind === 'punch-in' ? `_L${String(t.startLine + 1).padStart(2, '0')}${words ? `_${words}` : ''}` : '';
  return `${episodeLabel}_Take${t.number}${line}.wav`;
}

/**
 * Writes one take as it records: collects samples and saves a segment every
 * five seconds. Call push() with each captured chunk (interleaved when stereo)
 * and finish() at the end.
 */
export class TakeWriter {
  private pending: Float32Array[] = [];
  private pendingSamples = 0;
  private peakAcc = 0;
  private peakCount = 0;
  private writing: Promise<void> = Promise.resolve();
  private releaseLock!: () => void;
  private dir!: FileSystemDirectoryHandle;
  /** The clock sync points are logged on: the session's shared clock with a guest, else this device's. */
  private clock: () => number = Date.now;
  /** This segment's least-late chunk: chunks only ever arrive late, so it's the truest. */
  private best: SyncPoint | null = null;

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

  /** Log sync points on the session's shared clock (call before recording starts). */
  useClock(clock: () => number, kind: SyncLog['clock']) {
    this.clock = clock;
    this.meta.sync = { clock: kind, points: [] };
  }

  get seconds() {
    return (this.meta.samples + this.pendingSamples) / this.meta.sampleRate;
  }

  push(samples: Float32Array) {
    this.pending.push(samples);
    this.pendingSamples += samples.length / channelsOf(this.meta);
    // When these frames arrived: the least-late chunk of each segment becomes a sync point.
    const p: SyncPoint = [this.meta.samples + this.pendingSamples, Math.round(this.clock())];
    const late = (x: SyncPoint) => x[1] - (x[0] * 1000) / this.meta.sampleRate;
    if (!this.best || late(p) < late(this.best)) this.best = p;
    const perPeak = this.meta.sampleRate * PEAK_SECONDS * channelsOf(this.meta);
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
    if (this.best) (this.meta.sync ??= { clock: 'local', points: [] }).points.push(this.best);
    this.best = null;
    if (!count) return this.writing;
    this.writing = this.writing.then(async () => {
      const joined = new Float32Array(count * channelsOf(this.meta));
      let o = 0;
      for (const c of chunks) {
        joined.set(c, o);
        o += c.length;
      }
      // Counted once it's on disk: an uploader reading `segments` must never see a file still being written.
      const n = this.meta.segments + 1;
      await writeFile(this.dir, segName(n), pcmBytes(joined, this.meta.bitDepth) as BlobPart);
      this.meta.segments = n;
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
export async function storageLeft(sampleRate: number, bitDepth: BitDepth, channels: Channels = 1) {
  const { quota = 0, usage = 0 } = await navigator.storage.estimate();
  const free = Math.max(0, quota - usage);
  return { free, hours: free / (sampleRate * (bitDepth / 8) * channels * 3600) };
}

export function formatBytes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}
