/*
 * The host's recordings, uploaded as they're made: each 5 s segment as it's
 * saved in the browser, and the take's meta (markers, line log, pads) as it
 * changes. On disk as in the browser: takes/<id>/seg-NNNNNN.pcm + meta.json.
 *
 *   GET  /api/takes?episode=:id          takes on the server (meta, segments, done)
 *   GET  /api/takes/:id                  one: { meta, segments, done }
 *   PUT  /api/takes/:id {meta, done}     create or update its meta
 *   PUT  /api/takes/:id/segments/:n      raw PCM (streamed; empty refused)
 *   GET  /api/takes/:id/segments/:n
 *   DELETE /api/takes/:id
 */
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { TakeMeta } from '../src/lib/audio/takes.ts';
import type { Context } from './context.ts';
import { HttpError, SEGMENT_LIMIT, json, readJson, streamToFile } from './http.ts';

const segName = (n: number) => `seg-${String(n).padStart(6, '0')}.pcm`;
const safeId = (id: string) => /^[A-Za-z0-9_-]{1,80}$/.test(id);

export class Takes {
  private ctx: Context;
  constructor(ctx: Context) {
    this.ctx = ctx;
  }
  private dir(id: string) {
    return join(this.ctx.config.data, 'takes', id);
  }

  private async count(id: string) {
    try {
      return (await readdir(this.dir(id))).filter((f) => /^seg-\d+\.pcm$/.test(f)).length;
    } catch {
      return 0;
    }
  }

  /** Expose legacy guest uploads through the authenticated take reader without copying PCM. */
  private async guestSource(host: TakeMeta) {
    const sessionId = host.guest?.sessionId;
    if (!sessionId || !safeId(sessionId) || this.ctx.live.session(sessionId)?.episodeId !== host.episodeId) return null;
    const dir = join(this.ctx.config.data, 'live', sessionId, 'guest');
    try {
      const guest = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
      if (!guest.done || !Number.isInteger(guest.segments) || guest.segments < 1 || guest.segments > 100000 || ![16, 24].includes(guest.bitDepth) || ![1, 2].includes(guest.channels ?? 1) || !(guest.sampleRate > 0)) return null;
      const segmentBytes = await Promise.all(Array.from({ length: guest.segments }, (_, i) => stat(join(dir, segName(i + 1))).then((s) => s.size)));
      if (segmentBytes.some((n) => n <= 0)) return null;
      const meta: TakeMeta = { ...host, id: `${host.id}-guest`, name: `${host.name} · ${guest.name}`, speaker: String(guest.name ?? 'Guest').toUpperCase(), device: 'Guest device', guest: undefined, pads: undefined, remote: true, status: 'done', sampleRate: guest.sampleRate, bitDepth: guest.bitDepth, channels: guest.channels ?? 1, segments: guest.segments, samples: segmentBytes.reduce((n, size) => n + size, 0) / ((guest.channels ?? 1) * guest.bitDepth / 8), startedAtServer: guest.startedAtServer ?? undefined, sync: guest.sync ?? undefined, peaks: [] };
      return { id: meta.id, meta, segments: guest.segments as number, done: true, segmentBytes, dir };
    } catch { return null; }
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL, p: string[]): Promise<boolean> {
    if (p[0] !== 'takes') return false;
    const db = this.ctx.db;
    if (p.length === 1 && req.method === 'GET') {
      const ep = url.searchParams.get('episode');
      const rows = (ep ? db.prepare('SELECT * FROM takes WHERE episode_id = ? ORDER BY updated_at').all(ep) : db.prepare('SELECT * FROM takes ORDER BY updated_at').all()) as {
        id: string;
        meta: string;
        segments: number;
        done: number;
      }[];
      const takes = rows.map((r) => ({ id: r.id, meta: JSON.parse(r.meta), segments: r.segments, done: !!r.done }));
      for (const host of [...takes]) {
        const guest = await this.guestSource(host.meta);
        if (guest && !takes.some((t) => t.id === guest.id)) takes.push({ id: guest.id, meta: guest.meta, segments: guest.segments, done: true });
      }
      return json(res, 200, { takes }), true;
    }
    const id = p[1];
    if (!id || !safeId(id)) throw new HttpError(404, 'Not found');
    const row = db.prepare('SELECT * FROM takes WHERE id = ?').get(id) as { meta: string; segments: number; done: number } | undefined;

    const host = !row && req.method === 'GET' && id.endsWith('-guest') ? db.prepare('SELECT meta FROM takes WHERE id = ?').get(id.slice(0, -6)) as { meta: string } | undefined : undefined;
    const guest = host ? await this.guestSource(JSON.parse(host.meta)) : null;

    if (p.length === 2) {
      if (req.method === 'GET') {
        if (guest) return json(res, 200, { meta: guest.meta, segments: guest.segments, done: true, segmentBytes: guest.segmentBytes }), true;
        if (!row) throw new HttpError(404, 'No such take');
        const segmentBytes = await Promise.all(Array.from({ length: row.segments }, (_, i) => stat(join(this.dir(id), segName(i + 1))).then((s) => s.size).catch(() => 0)));
        return json(res, 200, { meta: JSON.parse(row.meta), segments: row.segments, done: !!row.done, segmentBytes }), true;
      }
      if (req.method === 'PUT') {
        const { meta, done } = await readJson<{ meta?: { episodeId?: string }; done?: boolean }>(req, 4 << 20);
        if (!meta || typeof meta.episodeId !== 'string') throw new HttpError(400, 'No take meta');
        await mkdir(this.dir(id), { recursive: true });
        await writeFile(join(this.dir(id), 'meta.json'), JSON.stringify(meta));
        const segments = await this.count(id);
        db.prepare(
          'INSERT INTO takes (id, episode_id, meta, segments, done, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET meta = excluded.meta, segments = excluded.segments, done = excluded.done, updated_at = excluded.updated_at',
        ).run(id, meta.episodeId, JSON.stringify(meta), segments, done ? 1 : 0, Date.now());
        return json(res, 200, { segments }), true;
      }
      if (req.method === 'DELETE') {
        await rm(this.dir(id), { recursive: true, force: true });
        db.prepare('DELETE FROM takes WHERE id = ?').run(id);
        return json(res, 200, {}), true;
      }
    }

    if (p[2] === 'segments' && p[3] && p.length === 4) {
      const n = Number(p[3]);
      if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Bad segment number');
      const file = join(guest?.dir ?? this.dir(id), segName(n));
      if (req.method === 'PUT') {
        if (!row) throw new HttpError(404, 'Describe the take first');
        await mkdir(this.dir(id), { recursive: true });
        await streamToFile(req, file, SEGMENT_LIMIT).catch((err) => {
          throw err instanceof HttpError && err.message === 'Empty body' ? new HttpError(400, 'Empty segment') : err;
        });
        const segments = await this.count(id);
        db.prepare('UPDATE takes SET segments = ?, updated_at = ? WHERE id = ?').run(segments, Date.now(), id);
        return json(res, 200, { segments }), true;
      }
      if (req.method === 'GET') {
        if (!existsSync(file)) throw new HttpError(404, 'No such segment');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', (await stat(file)).size);
        createReadStream(file).pipe(res);
        return true;
      }
    }
    throw new HttpError(404, 'Not found');
  }
}
