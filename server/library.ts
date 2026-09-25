/*
 * The show's content on the server: episodes, their scripts (versioned, so
 * two browsers can't silently overwrite each other), show setup, hotkey pads,
 * and the pad sound library (media/<id>.wav). One show for now; the tables
 * allow more.
 *
 *   GET    /api/episodes                    list, with script words and sessions
 *   POST   /api/episodes {title}            new episode (next number)
 *   GET    /api/episodes/:id                one, with script, setup and pads
 *   PATCH  /api/episodes/:id {title}        rename
 *   DELETE /api/episodes/:id
 *   PUT    /api/episodes/:id/script {text, base}   409 with the current copy if base is stale
 *   DELETE /api/episodes/:id/script         back to the example script
 *   PUT    /api/episodes/:id/setup {…}      show setup (lib/show.ts)
 *   PUT    /api/pads/show [pads]            the show set
 *   PUT    /api/pads/episode/:id [pads]     an episode's overrides
 *   GET    /api/media                       the sound library
 *   PUT    /api/media/:id?name&source&seconds   upload a WAV (streamed)
 *   GET    /api/media/:id                   the WAV
 */
import { createReadStream, existsSync } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Context } from './context.ts';
import { tx } from './db.ts';
import { HttpError, json, readJson, streamToFile } from './http.ts';

export interface Episode {
  id: string;
  number: number;
  title: string;
  label: string;
  fullTitle: string;
  createdAt: number;
  updatedAt: number;
}
export interface EpisodeRow extends Episode {
  words: number | null;
  sessions: number;
  customScript: boolean;
}
export interface EpisodeData {
  episode: Episode;
  script: { text: string; version: number } | null;
  setup: Record<string, unknown> | null;
  pads: { show: unknown[]; episode: unknown[] };
}

const MEDIA_LIMIT = 200 << 20;
const words = (text: string) => text.split(/\s+/).filter((w) => w && !/^#+$/.test(w) && !/^[A-Z][A-Z0-9 .'-]{0,23}:$/.test(w)).length;
const toEpisode = (r: { id: string; number: number; title: string; created_at: number; updated_at: number }): Episode => ({
  id: r.id,
  number: r.number,
  title: r.title,
  label: `Ep. ${r.number}`,
  fullTitle: `Ep. ${r.number} — ${r.title}`,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const safeId = (id: string) => /^[A-Za-z0-9_-]{1,40}$/.test(id);

export class Library {
  private ctx: Context;
  constructor(ctx: Context) {
    this.ctx = ctx;
  }
  private get db() {
    return this.ctx.db;
  }

  /** The show (made on first use, with the example episode, Ep. 142, to rehearse with). */
  showId(): number {
    const row = this.db.prepare('SELECT id FROM shows ORDER BY id LIMIT 1').get() as { id: number } | undefined;
    if (row) return row.id;
    return tx(this.db, () => {
      const id = Number(this.db.prepare('INSERT INTO shows (name, created_at) VALUES (?, ?)').run('My show', Date.now()).lastInsertRowid);
      this.db.prepare('INSERT INTO episodes (id, show_id, number, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('142', id, 142, 'The Transmitter', Date.now(), Date.now());
      return id;
    });
  }

  list(): EpisodeRow[] {
    const show = this.showId();
    const rows = this.db
      .prepare(
        `SELECT e.*, s.text AS script, (SELECT count(*) FROM takes t WHERE t.episode_id = e.id) AS sessions
         FROM episodes e LEFT JOIN scripts s ON s.episode_id = e.id WHERE e.show_id = ? ORDER BY e.number DESC`,
      )
      .all(show) as (Parameters<typeof toEpisode>[0] & { script: string | null; sessions: number })[];
    return rows.map((r) => ({ ...toEpisode(r), words: r.script ? words(r.script) : null, sessions: r.sessions, customScript: r.script != null }));
  }

  get(id: string): Episode | null {
    this.showId();
    const r = this.db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as Parameters<typeof toEpisode>[0] | undefined;
    return r ? toEpisode(r) : null;
  }

  /** Everything a page for this episode needs up front. */
  data(id: string): EpisodeData | null {
    const episode = this.get(id);
    if (!episode) return null;
    const script = this.db.prepare('SELECT text, version FROM scripts WHERE episode_id = ?').get(id) as { text: string; version: number } | undefined;
    const setup = this.db.prepare('SELECT json FROM show_setup WHERE episode_id = ?').get(id) as { json: string } | undefined;
    return { episode, script: script ?? null, setup: setup ? JSON.parse(setup.json) : null, pads: this.pads(id) };
  }

  create(title: string): Episode {
    const show = this.showId();
    return tx(this.db, () => {
      const next = ((this.db.prepare('SELECT max(number) AS n FROM episodes WHERE show_id = ?').get(show) as { n: number | null }).n ?? 0) + 1;
      let id = String(next);
      if (this.db.prepare('SELECT 1 FROM episodes WHERE id = ?').get(id)) id = `${next}-${Date.now().toString(36)}`;
      const now = Date.now();
      this.db.prepare('INSERT INTO episodes (id, show_id, number, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, show, next, title, now, now);
      return this.get(id)!;
    });
  }

  private touch(id: string) {
    this.db.prepare('UPDATE episodes SET updated_at = ? WHERE id = ?').run(Date.now(), id);
  }

  pads(episodeId: string | null) {
    const show = this.showId();
    const parse = (rows: { json: string }[]) => rows.map((r) => JSON.parse(r.json));
    return {
      show: parse(this.db.prepare('SELECT json FROM pads WHERE show_id = ? AND episode_id IS NULL ORDER BY key').all(show) as { json: string }[]),
      episode: episodeId ? parse(this.db.prepare('SELECT json FROM pads WHERE show_id = ? AND episode_id = ? ORDER BY key').all(show, episodeId) as { json: string }[]) : [],
    };
  }

  private savePads(episodeId: string | null, pads: { id?: string; key?: number }[]) {
    const show = this.showId();
    if (!Array.isArray(pads) || pads.length > 9) throw new HttpError(400, 'A set is up to nine pads');
    const keys = new Set<number>();
    for (const p of pads) {
      if (!p || typeof p.id !== 'string' || !Number.isInteger(p.key) || p.key! < 1 || p.key! > 9 || keys.has(p.key!)) throw new HttpError(400, 'Each pad needs an id and its own key, 1–9');
      keys.add(p.key!);
    }
    tx(this.db, () => {
      if (episodeId == null) this.db.prepare('DELETE FROM pads WHERE show_id = ? AND episode_id IS NULL').run(show);
      else this.db.prepare('DELETE FROM pads WHERE show_id = ? AND episode_id = ?').run(show, episodeId);
      const ins = this.db.prepare('INSERT INTO pads (id, show_id, episode_id, key, json) VALUES (?, ?, ?, ?, ?)');
      for (const p of pads) ins.run(`${episodeId ?? 'show'}:${p.id}`, show, episodeId, p.key!, JSON.stringify(p));
    });
  }

  /** /api/episodes/**, /api/pads/**, /api/media/**; false for anything else. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL, p: string[]): Promise<boolean> {
    const m = req.method;
    if (p[0] === 'episodes') {
      if (p.length === 1 && m === 'GET') return json(res, 200, { episodes: this.list() }), true;
      if (p.length === 1 && m === 'POST') {
        const { title } = await readJson<{ title?: string }>(req);
        const t = String(title ?? '').trim().slice(0, 120) || 'Untitled';
        return json(res, 200, { episode: this.create(t) }), true;
      }
      const id = p[1];
      if (!safeId(id) || !this.get(id)) throw new HttpError(404, 'No such episode');
      if (p.length === 2 && m === 'GET') return json(res, 200, this.data(id)), true;
      if (p.length === 2 && m === 'PATCH') {
        const { title } = await readJson<{ title?: string }>(req);
        const t = String(title ?? '').trim().slice(0, 120);
        if (!t) throw new HttpError(400, 'Give it a title');
        this.db.prepare('UPDATE episodes SET title = ?, updated_at = ? WHERE id = ?').run(t, Date.now(), id);
        return json(res, 200, { episode: this.get(id) }), true;
      }
      if (p.length === 2 && m === 'DELETE') {
        this.db.prepare('DELETE FROM episodes WHERE id = ?').run(id);
        return json(res, 200, {}), true;
      }
      if (p[2] === 'script' && m === 'PUT') {
        const { text, base } = await readJson<{ text?: string; base?: number }>(req, 4 << 20);
        if (typeof text !== 'string') throw new HttpError(400, 'No script text');
        const cur = this.db.prepare('SELECT text, version FROM scripts WHERE episode_id = ?').get(id) as { text: string; version: number } | undefined;
        // Changed somewhere else since this browser loaded it: say so, with the current copy.
        if (cur && base != null && base !== cur.version) return json(res, 409, { error: 'The script was changed somewhere else', script: cur }), true;
        const version = (cur?.version ?? 0) + 1;
        this.db
          .prepare('INSERT INTO scripts (episode_id, text, version, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (episode_id) DO UPDATE SET text = excluded.text, version = excluded.version, updated_at = excluded.updated_at')
          .run(id, text, version, Date.now());
        this.touch(id);
        return json(res, 200, { version }), true;
      }
      if (p[2] === 'script' && m === 'DELETE') {
        this.db.prepare('DELETE FROM scripts WHERE episode_id = ?').run(id);
        this.touch(id);
        return json(res, 200, {}), true;
      }
      if (p[2] === 'setup' && m === 'PUT') {
        const setup = await readJson(req);
        this.db
          .prepare('INSERT INTO show_setup (episode_id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT (episode_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at')
          .run(id, JSON.stringify(setup), Date.now());
        return json(res, 200, {}), true;
      }
      throw new HttpError(404, 'Not found');
    }

    if (p[0] === 'pads' && m === 'PUT') {
      const pads = await readJson<{ id?: string; key?: number }[]>(req);
      if (p[1] === 'show' && p.length === 2) this.savePads(null, pads);
      else if (p[1] === 'episode' && p[2] && safeId(p[2]) && this.get(p[2])) this.savePads(p[2], pads);
      else throw new HttpError(404, 'Not found');
      return json(res, 200, {}), true;
    }

    if (p[0] === 'media') {
      if (p.length === 1 && m === 'GET') {
        const rows = this.db.prepare('SELECT id, name, source, seconds, created_at AS addedAt FROM media ORDER BY created_at DESC').all();
        return json(res, 200, { media: rows }), true;
      }
      const id = p[1];
      if (!id || !safeId(id) || p.length !== 2) throw new HttpError(404, 'Not found');
      const file = join(this.ctx.config.data, 'media', `${id}.wav`);
      if (m === 'PUT') {
        const bytes = await streamToFile(req, file, MEDIA_LIMIT);
        const name = (url.searchParams.get('name') ?? id).slice(0, 120);
        const seconds = Number(url.searchParams.get('seconds')) || 0;
        this.db
          .prepare('INSERT INTO media (id, name, source, seconds, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, source = excluded.source, seconds = excluded.seconds, bytes = excluded.bytes')
          .run(id, name, url.searchParams.get('source')?.slice(0, 200) ?? null, seconds, bytes, Date.now());
        return json(res, 200, {}), true;
      }
      if (m === 'GET') {
        if (!existsSync(file)) throw new HttpError(404, 'No such sound');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Length', (await stat(file)).size);
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
        createReadStream(file).pipe(res);
        return true;
      }
      if (m === 'DELETE') {
        await rm(file, { force: true });
        this.db.prepare('DELETE FROM media WHERE id = ?').run(id);
        return json(res, 200, {}), true;
      }
    }
    return false;
  }
}
