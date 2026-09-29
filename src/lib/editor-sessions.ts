import type { TakeMeta } from './audio/takes';
import { pcmFloats } from './audio/wav.ts';
import type { EditorSourceReader } from './audio/editor-render';

export interface RemoteTake { id: string; meta: TakeMeta; segments: number; done: boolean }
/** Stable recording-date order, local audio preferred when complete. One entry per take. */
export function mergeEditorTakes(local: TakeMeta[], remote: RemoteTake[]): TakeMeta[] {
  const found = new Map<string, TakeMeta>(remote.filter((r) => r.done).map((r) => [r.id, { ...r.meta, id: r.id, status: 'done' as const, segments: r.segments, remote: true }]));
  for (const t of local) if (t.status === 'done') found.set(t.id, t);
  return [...found.values()].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
}
export function editorSessions(takes: TakeMeta[]) {
  // Guest takes belong to the host's group; they are not separate projects.
  const hosts = new Map<string, TakeMeta>();
  for (const t of takes.filter((t) => t.status === 'done')) {
    const key = t.group ?? t.id;
    const previous = hosts.get(key);
    if (!previous || t.guest || (!previous.guest && !t.remote && previous.remote)) hosts.set(key, t);
  }
  return [...hosts.values()].sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id));
}
/** Server PCM is fetched only for overlapping segments; keep at most eight segments. */
export function remoteSource(meta: TakeMeta, sizes: number[]): EditorSourceReader {
  const cache = new Map<number, ArrayBuffer>();
  const pending = new Map<number, Promise<ArrayBuffer>>();
  const bytesPerFrame = (meta.channels ?? 1) * meta.bitDepth / 8;
  const offsets: number[] = []; let total = 0;
  for (const size of sizes) { offsets.push(total); total += size; }
  return { channels: meta.channels ?? 1, sampleRate: meta.sampleRate, async read(from, seconds) {
    const frames = Math.max(0, Math.round(seconds * meta.sampleRate));
    const output = new Uint8Array(frames * bytesPerFrame);
    const begin = Math.round(from * meta.sampleRate) * bytesPerFrame;
    for (let i = 0; i < sizes.length; i++) {
      const a = Math.max(begin, offsets[i]), b = Math.min(begin + output.length, offsets[i] + sizes[i]);
      if (b <= a) continue;
      let buffer = cache.get(i);
      if (!buffer) {
        let request = pending.get(i);
        if (!request) {
          request = fetch(`/api/takes/${encodeURIComponent(meta.id)}/segments/${i + 1}`, { credentials: 'same-origin' }).then(async (r) => {
            if (!r.ok) throw new Error(`Audio segment ${i + 1} is unavailable (${r.status}). Retry or recover the guest file.`);
            const bytes = await r.arrayBuffer();
            if (bytes.byteLength !== sizes[i]) throw new Error('An audio segment is incomplete. Retry after uploads finish.');
            cache.set(i, bytes); if (cache.size > 8) cache.delete(cache.keys().next().value!); return bytes;
          }).finally(() => pending.delete(i)); pending.set(i, request);
        }
        buffer = await request;
      }
      output.set(new Uint8Array(buffer, a - offsets[i], b - a), a - begin);
    }
    return pcmFloats(output, meta.bitDepth);
  } };
}
