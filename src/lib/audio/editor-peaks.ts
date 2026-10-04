import type { EditorSourceReader } from './editor-render.ts';

export const PEAK_SECONDS = 0.02;
const CHUNK_SECONDS = 10;
const CACHE_VERSION = 2;
const memory = new Map<string, number[]>();
const pending = new Map<string, Promise<number[]>>();
const removed = new Set<string>();

/** Drop waveform-only data without touching independent media files. */
export async function clearSourcePeaks(ids: string[]) {
  for (const id of ids) removed.add(id);
  const matches = (key: string) => ids.some((id) => key.startsWith(`v${CACHE_VERSION}:${id}:`));
  for (const key of memory.keys()) if (matches(key)) memory.delete(key);
  const db = await database();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction('chunks', 'readwrite');
    const cursor = tx.objectStore('chunks').openCursor();
    cursor.onsuccess = () => { const entry = cursor.result; if (!entry) return; if (matches(String(entry.key))) entry.delete(); entry.continue(); };
    tx.oncomplete = tx.onerror = () => { db.close(); resolve(); };
  });
}

export interface WaveformBar { left: number; height: number }

export interface WaveformPaths {
  upper: string;
  lower: string;
  upperArea: string;
  lowerArea: string;
  /** Hindenburg-style rectified trace: body (RMS-like) and peak edge. */
  rectified: string;
  rectifiedBody: string;
  rectifiedArea: string;
  rectifiedBodyArea: string;
}

/**
 * Turn the bounded peak bars into a quiet analyzer-style trace. The editor
 * keeps the source-time bars for selection and testing, while this path gives
 * the clip the filled spectrum/MPX treatment used elsewhere in the UI.
 */
export function waveformPaths(bars: WaveformBar[], width: number, height = 78, inset = 0): WaveformPaths {
  // Hindenburg uses a rectified waveform: the useful level information sits
  // above a quiet baseline, with a darker RMS-like body and a lighter peak
  // edge. Keep the old mirrored paths available for callers that still need
  // them, but make the rectified paths the editor's primary representation.
  const center = height / 2;
  // Leave only a small bottom inset so the rectified waveform reaches the
  // lower edge of the clip, like a Hindenburg region display.
  const rectifiedBaseline = Math.max(8, height - 8);
  const drawWidth = Math.max(1, width - inset);
  const points = bars
    .filter((bar) => Number.isFinite(bar.left) && Number.isFinite(bar.height))
    .map((bar) => {
      const x = inset + Math.max(0, Math.min(drawWidth, (bar.left / Math.max(1, width)) * drawWidth));
      // `bar.height` is calibrated for the default 50px viewport. Scale it
      // with taller rows so the analyzer trace grows instead of staying as a
      // small line in the middle of an expanded clip.
      const amplitude = Math.max(1, Math.min(center - 2, (bar.height / 46) * (center - 2)));
      // `WaveformBar.height` is derived from the source peak. Convert it
      // back to dBFS before placing the rectified trace so the guide labels
      // describe the actual vertical position of the waveform.
      const linearPeak = Math.max(1e-6, Math.min(1, (bar.height / 46) ** 2));
      const dbfs = 20 * Math.log10(linearPeak);
      const dbfsPosition = Math.max(0, Math.min(1, (dbfs + 60) / 60));
      const rectifiedAmplitude = Math.max(1, dbfsPosition * (rectifiedBaseline - 8));
      return {
        x,
        upper: center - amplitude,
        lower: center + amplitude,
        rectified: rectifiedBaseline - rectifiedAmplitude,
        // Keep the RMS-like body close to the peak edge so the region reads
        // as one Hindenburg-style waveform instead of two offset traces.
        rectifiedBody: rectifiedBaseline - rectifiedAmplitude * 0.82,
      };
    });
  if (!points.length) return { upper: '', lower: '', upperArea: '', lowerArea: '', rectified: '', rectifiedBody: '', rectifiedArea: '', rectifiedBodyArea: '' };
  const upper = `M ${points.map((point) => `${point.x.toFixed(2)} ${point.upper.toFixed(2)}`).join(' L ')}`;
  const lower = `M ${points.map((point) => `${point.x.toFixed(2)} ${point.lower.toFixed(2)}`).join(' L ')}`;
  const rectified = `M ${points.map((point) => `${point.x.toFixed(2)} ${point.rectified.toFixed(2)}`).join(' L ')}`;
  const rectifiedBody = `M ${points.map((point) => `${point.x.toFixed(2)} ${point.rectifiedBody.toFixed(2)}`).join(' L ')}`;
  const first = points[0];
  const last = points[points.length - 1];
  return {
    upper,
    lower,
    upperArea: `${upper} L ${last.x.toFixed(2)} ${center.toFixed(2)} L ${first.x.toFixed(2)} ${center.toFixed(2)} Z`,
    lowerArea: `${lower} L ${last.x.toFixed(2)} ${center.toFixed(2)} L ${first.x.toFixed(2)} ${center.toFixed(2)} Z`,
    rectified,
    rectifiedBody,
    rectifiedArea: `${rectified} L ${last.x.toFixed(2)} ${rectifiedBaseline.toFixed(2)} L ${first.x.toFixed(2)} ${rectifiedBaseline.toFixed(2)} Z`,
    rectifiedBodyArea: `${rectifiedBody} L ${last.x.toFixed(2)} ${rectifiedBaseline.toFixed(2)} L ${first.x.toFixed(2)} ${rectifiedBaseline.toFixed(2)} Z`,
  };
}

/** Positions bars in source time, applying the live track gain for display. */
export function waveformBars(peaks: number[], sourceStart: number, sourceEnd: number, pxPerSecond: number, visibleFrom: number, visibleTo: number, gainDb = 0): WaveformBar[] {
  const stride = Math.max(1, Math.round(3 / (pxPerSecond * PEAK_SECONDS)));
  const gain = Math.pow(10, gainDb / 20);
  const first = Math.max(0, Math.floor(Math.max(sourceStart, visibleFrom) / (stride * PEAK_SECONDS)));
  const last = Math.ceil(Math.min(sourceEnd, visibleTo) / (stride * PEAK_SECONDS));
  const bars: WaveformBar[] = [];
  for (let group = first; group < last; group++) {
    const start = group * stride;
    const end = Math.min(peaks.length, start + stride);
    let peak = 0;
    let loaded = false;
    for (let i = start; i < end; i++) {
      if (peaks[i] !== undefined) { peak = Math.max(peak, Math.min(1, peaks[i] * gain)); loaded = true; }
    }
    if (!loaded) continue;
    bars.push({ left: (start * PEAK_SECONDS - sourceStart) * pxPerSecond, height: Math.max(2, Math.min(46, Math.sqrt(peak) * 46)) });
  }
  return bars;
}

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
  if (removed.has(sourceId)) throw new Error('This recording was deleted');
  const first = Math.max(0, Math.floor(from / CHUNK_SECONDS));
  const last = Math.min(Math.ceil(duration / CHUNK_SECONDS), Math.ceil(to / CHUNK_SECONDS));
  for (let index = first; index < last; index++) {
    const start = index * CHUNK_SECONDS;
    const key = `v${CACHE_VERSION}:${sourceId}:${reader.sampleRate}:${reader.channels}:${duration}:${index}`;
    let peaks = memory.get(key);
    if (!peaks) {
      let request = pending.get(key);
      if (!request) {
        request = (async () => {
          const cached = await stored(key);
          if (cached) return cached;
          const built = await peakChunk(reader, start, Math.min(CHUNK_SECONDS, duration - start));
          if (!removed.has(sourceId)) await persist(key, built);
          return built;
        })().finally(() => pending.delete(key));
        pending.set(key, request);
      }
      peaks = await request;
      if (!removed.has(sourceId)) memory.set(key, peaks);
    }
    onChunk?.({ start: Math.round(start / PEAK_SECONDS), peaks });
  }
}
