/*
 * The host's recording, sent to the server as it's made: the take's meta
 * (markers, line log, pads) and each 5 s segment once it's saved in this
 * browser. Retries with backoff while offline; whatever's left when the page
 * closes goes up from the next page (resumeUploads).
 */
import { getTake, listTakes, segmentFile, type TakeMeta } from './audio/takes';
import { Uploader, type UploadStatus } from './upload';

const base = (id: string) => `/api/takes/${encodeURIComponent(id)}`;

async function putMeta(meta: TakeMeta, done: boolean) {
  const res = await fetch(base(meta.id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meta, done }),
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`Meta ${res.status}`);
}

async function putSegment(meta: TakeMeta, n: number) {
  const file = await segmentFile(meta, n);
  // A piece is never empty; if it reads empty it isn't committed yet, so try again.
  if (!file.size) throw new Error('Piece not saved yet');
  const res = await fetch(`${base(meta.id)}/segments/${n}`, { method: 'PUT', body: file, credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Segment ${res.status}`);
}

export interface TakeUpload {
  /** Send what's waiting (call often; safe to overlap) */
  tick(): void;
  status(): UploadStatus & { lastSent: number };
  /** At the end: everything, then the meta marked done. Resolves true if all of it arrived. */
  finish(meta: TakeMeta, timeoutMs?: number): Promise<boolean>;
}

/** Start sending a take that's being recorded. `meta` is the live writer meta. */
export function startTakeUpload(meta: TakeMeta, from = 0): TakeUpload {
  let lastSent = 0;
  let metaSent = false;
  let metaKey = '';
  const uploader = new Uploader(
    () => (metaSent ? meta.segments : 0),
    async (n) => {
      await putSegment(meta, n);
      lastSent = Date.now();
    },
    () => {},
    from,
  );
  let sendingMeta = false;
  const syncMeta = async () => {
    // Markers, the line log and pads change as it records: send the meta when they do.
    const key = `${meta.segments}|${meta.markers?.length ?? 0}|${meta.lineLog?.length ?? 0}|${meta.pads?.presses.length ?? 0}`;
    if (sendingMeta || key === metaKey) return;
    sendingMeta = true;
    try {
      await putMeta(meta, false);
      metaKey = key;
      metaSent = true;
      lastSent ||= Date.now();
    } catch {
    } finally {
      sendingMeta = false;
    }
  };
  return {
    tick() {
      syncMeta().then(() => uploader.tick());
    },
    status() {
      return { ...uploader.status, lastSent };
    },
    async finish(final, timeoutMs = 10000) {
      await syncMeta();
      const all = metaSent && (await uploader.flush(timeoutMs));
      if (!all) return false;
      return putMeta(final, true).then(
        () => true,
        () => false,
      );
    },
  };
}

/**
 * Finish sending this browser's takes the server doesn't have all of (the
 * page closed before they went up, or the network was down). Guests' tracks
 * and takes fetched from the server are left alone.
 */
export async function resumeUploads(episodeId: string, onProgress?: (take: TakeMeta, sent: number) => void) {
  for (const t of await listTakes(episodeId)) {
    if (t.remote || t.status !== 'done' || !t.segments) continue;
    let have = 0;
    let done = false;
    try {
      const res = await fetch(base(t.id), { credentials: 'same-origin' });
      if (res.status === 401) return;
      if (res.ok) ({ segments: have, done } = (await res.json()) as { segments: number; done: boolean });
    } catch {
      return;
    }
    if (done && have >= t.segments) continue;
    const meta = (await getTake(t.id)) ?? t;
    const up = startTakeUpload(meta, have);
    const ok = await up.finish(meta, 120000);
    onProgress?.(meta, ok ? meta.segments : have);
  }
}

/** Takes on the server, optionally for one episode (to bring into this browser). */
export async function serverTakes(episodeId?: string): Promise<{ id: string; meta: TakeMeta; segments: number; done: boolean }[]> {
  try {
    const query = episodeId ? `?episode=${encodeURIComponent(episodeId)}` : '';
    const res = await fetch(`/api/takes${query}`, { credentials: 'same-origin' });
    return res.ok ? ((await res.json()) as { takes: { id: string; meta: TakeMeta; segments: number; done: boolean }[] }).takes : [];
  } catch {
    return [];
  }
}

/** One segment of a take on the server. */
export async function fetchTakeSegment(id: string, n: number): Promise<ArrayBuffer> {
  const res = await fetch(`${base(id)}/segments/${n}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Couldn’t fetch piece ${n}`);
  return res.arrayBuffer();
}
