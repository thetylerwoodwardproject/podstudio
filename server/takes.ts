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
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
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
      return json(res, 200, { takes: rows.map((r) => ({ id: r.id, meta: JSON.parse(r.meta), segments: r.segments, done: !!r.done })) }), true;
    }
    const id = p[1];
    if (!id || !safeId(id)) throw new HttpError(404, 'Not found');
    const row = db.prepare('SELECT * FROM takes WHERE id = ?').get(id) as { meta: string; segments: number; done: number } | undefined;

    if (p.length === 2) {
      if (req.method === 'GET') {
        if (!row) throw new HttpError(404, 'No such take');
        return json(res, 200, { meta: JSON.parse(row.meta), segments: row.segments, done: !!row.done }), true;
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
      const file = join(this.dir(id), segName(n));
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
