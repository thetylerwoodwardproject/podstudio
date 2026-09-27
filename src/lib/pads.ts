/*
 * Hotkey pads (handoff §7): nine sounds on the number keys, for a host on a
 * laptop. A show has one set, and an episode can override single pads.
 *
 * Until the Podstudio server exists, the sets live in this browser's
 * localStorage and the sounds in OPFS, `pads/<fileId>.wav` (48 kHz, 16-bit
 * stereo) with `pads/<fileId>.json` beside it. Files are never deleted when a
 * pad is cleared, so they stay in the library and old sessions can still be
 * rendered. The shapes match the server's `pads` table and `/api/media`.
 */

export type PadKind = 'bite' | 'clip' | 'music' | 'sfx';
export type PadMode = 'oneshot' | 'loop' | 'hold';
export type PadColor = 'yellow' | 'teal' | 'green' | 'red' | 'purple' | 'black';

export interface Pad {
  id: string;
  /** Number key, 1–9 */
  key: number;
  name: string;
  kind: PadKind;
  mode: PadMode;
  color: PadColor;
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  /** Seconds into the file; trimEnd 0 plays to the end */
  trimStart: number;
  trimEnd: number;
  duck: boolean;
  /** How far it drops under the voice, dB */
  duckDb: number;
  fileId: string;
  /** Length of the file, seconds */
  seconds: number;
  /** Where it came from: "Soundbite from Ep. 142", an upload's file name */
  source?: string;
}

/** Settings for the whole rail. */
export interface PadSettings {
  /** Pads volume, dB */
  volumeDb: number;
  duckAttackMs: number;
  duckReleaseMs: number;
  /** Voice above this (dBFS) ducks the pads that duck */
  threshold: number;
  /** Ducking on for the whole rail (each pad also has its own switch) */
  duck: boolean;
}

export const defaultPadSettings: PadSettings = { volumeDb: -6, duckAttackMs: 80, duckReleaseMs: 400, threshold: -40, duck: true };

/** The six standards colours. Pad variables are always emitted because this name is chosen at runtime. */
export const PAD_COLORS: PadColor[] = ['yellow', 'teal', 'green', 'red', 'purple', 'black'];
export const padColor = (c: PadColor) => `var(--pad-${c})`;
/** Pad label ink. Black is the only standards swatch that needs light type. */
export const PAD_INK = '#0B0B0C';
export const padInk = (c: PadColor) => c === 'black' ? 'var(--color-text)' : PAD_INK;

export const KIND_LABEL: Record<PadKind, string> = { bite: 'Soundbite', clip: 'Clip', music: 'Music', sfx: 'Sound effect' };

/** What each kind starts with. */
export const KIND_DEFAULTS: Record<PadKind, Pick<Pad, 'mode' | 'duck' | 'fadeInMs' | 'fadeOutMs' | 'duckDb'>> = {
  music: { mode: 'loop', duck: true, fadeInMs: 0, fadeOutMs: 2000, duckDb: 12 },
  sfx: { mode: 'oneshot', duck: false, fadeInMs: 0, fadeOutMs: 0, duckDb: 12 },
  bite: { mode: 'oneshot', duck: false, fadeInMs: 0, fadeOutMs: 150, duckDb: 12 },
  clip: { mode: 'oneshot', duck: false, fadeInMs: 0, fadeOutMs: 150, duckDb: 12 },
};

/** The tag on a pad: SFX, LOOP, BITE, CLIP, MUSIC or HOLD. */
export function padTag(p: Pick<Pad, 'kind' | 'mode'>): string {
  if (p.mode === 'hold') return 'HOLD';
  if (p.mode === 'loop') return 'LOOP';
  return { sfx: 'SFX', music: 'MUSIC', bite: 'BITE', clip: 'CLIP' }[p.kind];
}

/** Seconds a pad plays for once (after trimming). */
export const padLength = (p: Pick<Pad, 'trimStart' | 'trimEnd' | 'seconds'>) =>
  Math.max(0, (p.trimEnd > 0 ? Math.min(p.trimEnd, p.seconds) : p.seconds) - p.trimStart);

export function newPad(key: number, kind: PadKind, file: { id: string; seconds: number; name: string; source?: string }): Pad {
  return {
    id: `pad-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    key,
    name: file.name,
    kind,
    color: PAD_COLORS[(key - 1) % PAD_COLORS.length],
    gainDb: 0,
    trimStart: 0,
    trimEnd: 0,
    fileId: file.id,
    seconds: file.seconds,
    source: file.source,
    ...KIND_DEFAULTS[kind],
  };
}

/** A set: at most one pad per key. */
export type PadSet = Pad[];

/** The pads for an episode: the show set, with the episode's pads replacing the same keys. */
export function effectivePads(show: PadSet, episode: PadSet): (Pad & { override: boolean })[] {
  const byKey = new Map<number, Pad & { override: boolean }>();
  for (const p of show) byKey.set(p.key, { ...p, override: false });
  for (const p of episode) byKey.set(p.key, { ...p, override: true });
  return [...byKey.values()].sort((a, b) => a.key - b.key);
}

/** Put a set's pad on another key, swapping with whatever is there. */
export function swapKeys(set: PadSet, from: number, to: number): PadSet {
  return set.map((p) => (p.key === from ? { ...p, key: to } : p.key === to ? { ...p, key: from } : p));
}

/** Put a pad in a set (replacing the one on its key), or clear a key. */
export function setPad(set: PadSet, key: number, pad: Pad | null): PadSet {
  const rest = set.filter((p) => p.key !== key);
  return pad ? [...rest, { ...pad, key }].sort((a, b) => a.key - b.key) : rest;
}

// ── Stored in this browser until the server exists ────────────────────────────

const SHOW_KEY = 'podstudio:pads:show';
const epKey = (episodeId: string) => `podstudio:pads:ep:${episodeId}`;
const SETTINGS_KEY = 'podstudio:pads:settings';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export const loadShowPads = (): PadSet => read<PadSet>(SHOW_KEY, []);
export const saveShowPads = (set: PadSet) => {
  write(SHOW_KEY, set);
  return import('./sync').then((s) => s.pushPads(null));
};
export const loadEpisodePads = (episodeId: string): PadSet => read<PadSet>(epKey(episodeId), []);
export const saveEpisodePads = (episodeId: string, set: PadSet) => {
  write(epKey(episodeId), set);
  return import('./sync').then((s) => s.pushPads(episodeId));
};
export const loadPadSettings = (): PadSettings => ({ ...defaultPadSettings, ...read<Partial<PadSettings>>(SETTINGS_KEY, {}) });
export const savePadSettings = (patch: Partial<PadSettings>) => write(SETTINGS_KEY, { ...loadPadSettings(), ...patch });
export const padsFor = (episodeId: string) => effectivePads(loadShowPads(), loadEpisodePads(episodeId));

// ── The sound library (OPFS) ──────────────────────────────────────────────────

export const LIBRARY_RATE = 48000;

export interface LibraryFile {
  id: string;
  name: string;
  seconds: number;
  source?: string;
  addedAt: number;
}

async function libraryDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('pads', { create: true });
}

async function put(dir: FileSystemDirectoryHandle, name: string, data: BlobPart) {
  const handle = await dir.getFileHandle(name, { create: true });
  const w = await handle.createWritable();
  await w.write(data);
  await w.close();
}

/** Save stereo float audio (interleaved, 48 kHz) to the library as a 16-bit WAV. */
export async function saveLibraryFile(stereo: Float32Array, info: { name: string; source?: string }): Promise<LibraryFile> {
  const { encodeWav } = await import('./audio/wav');
  const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const file: LibraryFile = { id, name: info.name, source: info.source, seconds: stereo.length / 2 / LIBRARY_RATE, addedAt: Date.now() };
  const dir = await libraryDir();
  const wav = encodeWav([stereo], { sampleRate: LIBRARY_RATE, bitDepth: 16, channels: 2 });
  await put(dir, `${id}.wav`, wav);
  await put(dir, `${id}.json`, JSON.stringify(file));
  // To the server's library too, so other browsers (and the Pads track at export) have it.
  const q = new URLSearchParams({ name: file.name, seconds: String(file.seconds), ...(file.source ? { source: file.source } : {}) });
  let res: Response;
  try {
    res = await fetch(`/api/media/${id}?${q}`, { method: 'PUT', body: wav, credentials: 'same-origin' });
  } catch {
    throw new Error('Can’t reach the Podstudio server. The file remains in this browser.');
  }
  if (!res.ok) throw new Error(`The server refused this sound (${res.status}).`);
  return file;
}

/** A library file's audio: interleaved stereo floats at 48 kHz. */
export async function readLibraryFile(id: string): Promise<Float32Array> {
  const { parseWav, wavFloats } = await import('./audio/wav-read');
  const dir = await libraryDir();
  let bytes: ArrayBuffer;
  try {
    bytes = await (await (await dir.getFileHandle(`${id}.wav`)).getFile()).arrayBuffer();
  } catch {
    // Not in this browser yet: from the server's library, kept here for next time.
    const res = await fetch(`/api/media/${id}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Sound not found');
    bytes = await res.arrayBuffer();
    await put(dir, `${id}.wav`, bytes);
  }
  const info = parseWav(new DataView(bytes));
  if (!info) throw new Error('Not a WAV file');
  return wavFloats(bytes.slice(info.dataOffset, info.dataOffset + info.dataBytes), info);
}

export async function listLibrary(): Promise<LibraryFile[]> {
  const out: LibraryFile[] = [];
  // The server's library first (every sound uploaded from any browser), then anything only here.
  try {
    const res = await fetch('/api/media', { credentials: 'same-origin' });
    if (res.ok) out.push(...((await res.json()) as { media: LibraryFile[] }).media);
  } catch {}
  const dir = await libraryDir();
  for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemFileHandle]>) {
    if (!name.endsWith('.json')) continue;
    try {
      const f = JSON.parse(await (await handle.getFile()).text()) as LibraryFile;
      if (!out.some((x) => x.id === f.id)) out.push(f);
    } catch {}
  }
  return out.sort((a, b) => b.addedAt - a.addedAt);
}

/** Any audio file (WAV, MP3, M4A, FLAC) → interleaved stereo at 48 kHz. */
export async function decodeToLibraryRate(data: ArrayBuffer): Promise<Float32Array> {
  const probe = new OfflineAudioContext(2, 1, LIBRARY_RATE);
  const buf = await probe.decodeAudioData(data);
  const frames = Math.ceil(buf.duration * LIBRARY_RATE);
  const ctx = new OfflineAudioContext(2, Math.max(1, frames), LIBRARY_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return interleave(out.getChannelData(0), out.numberOfChannels > 1 ? out.getChannelData(1) : out.getChannelData(0));
}

export function interleave(l: Float32Array, r: Float32Array): Float32Array {
  const x = new Float32Array(l.length * 2);
  for (let i = 0; i < l.length; i++) {
    x[2 * i] = l[i];
    x[2 * i + 1] = r[i];
  }
  return x;
}
