import type { EditorSourceReader } from './editor-render.ts';

export const PEAK_SECONDS = 0.5;
const CHUNK_SECONDS = 10;
const memory = new Map<string, number[]>();
const pending = new Map<string, Promise<number[]>>();

function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open('podstudio-editor-peaks', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('chunks');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function stored(key: string): Promise<number[] | null> {
  const db = await database();
  if (!db) return null;
  return new Promise((resolve) => {
    const transaction = db.transaction('chunks', 'readonly');
    const request = transaction.objectStore('chunks').get(key);
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : null);
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => db.close();
  });
}

async function persist(key: string, peaks: number[]): Promise<void> {
  const db = await database();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction('chunks', 'readwrite');
    transaction.objectStore('chunks').put(peaks, key);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); resolve(); };
  });
}

/** One ten-second PCM read at most; never decode a complete long recording. */
export async function peakChunk(reader: EditorSourceReader, from: number, seconds: number): Promise<number[]> {
  const samples = await reader.read(from, seconds);
  const framesPerPeak = Math.max(1, Math.round(reader.sampleRate * PEAK_SECONDS));
  const frames = Math.floor(samples.length / reader.channels);
  const result: number[] = [];
  for (let first = 0; first < frames; first += framesPerPeak) {
    let peak = 0;
    for (let frame = first; frame < Math.min(frames, first + framesPerPeak); frame++) {
      for (let channel = 0; channel < reader.channels; channel++) peak = Math.max(peak, Math.abs(samples[frame * reader.channels + channel]));
    }
    result.push(Math.min(1, peak));
  }
  return result;
}

export async function sourcePeaks(sourceId: string, reader: EditorSourceReader, duration: number, from: number, to: number, onChunk?: (chunk: { start: number; peaks: number[] }) => void): Promise<void> {
  const first = Math.max(0, Math.floor(from / CHUNK_SECONDS));
  const last = Math.min(Math.ceil(duration / CHUNK_SECONDS), Math.ceil(to / CHUNK_SECONDS));
  for (let index = first; index < last; index++) {
    const start = index * CHUNK_SECONDS;
    const key = `${sourceId}:${reader.sampleRate}:${reader.channels}:${duration}:${index}`;
    let peaks = memory.get(key);
    if (!peaks) {
      let request = pending.get(key);
      if (!request) {
        request = (async () => {
          const cached = await stored(key);
          if (cached) return cached;
          const built = await peakChunk(reader, start, Math.min(CHUNK_SECONDS, duration - start));
          await persist(key, built);
          return built;
        })().finally(() => pending.delete(key));
        pending.set(key, request);
      }
      peaks = await request;
      memory.set(key, peaks);
    }
    onChunk?.({ start: Math.round(start / PEAK_SECONDS), peaks });
  }
}
