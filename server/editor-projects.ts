/* Non-destructive editor project metadata. Source audio stays in takes/media. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from './context.ts';
import { HttpError, json, readJson } from './http.ts';

interface StoredProject {
  take_id: string;
  episode_id: string;
  value: string;
  revision: number;
  updated_at: number;
}

const validProject = (value: unknown, takeId: string): value is { version: 1; takeId: string; episodeId: string; tracks: unknown[] } => {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  if (p.version !== 1 || p.takeId !== takeId || typeof p.episodeId !== 'string' || !Array.isArray(p.tracks) || p.tracks.length > 64) return false;
  return p.tracks.every((value) => {
    if (!value || typeof value !== 'object') return false;
    const track = value as Record<string, unknown>;
    if (typeof track.id !== 'string' || typeof track.sourceId !== 'string' || !['voice', 'pads', 'import'].includes(String(track.kind)) || !Array.isArray(track.clips) || track.clips.length > 10_000) return false;
    return track.clips.every((value) => {
      if (!value || typeof value !== 'object') return false;
      const clip = value as Record<string, unknown>;
      const start = Number(clip.sourceStart), end = Number(clip.sourceEnd), timeline = Number(clip.timelineStart);
      return typeof clip.id === 'string' && typeof clip.sourceId === 'string' && [start, end, timeline].every(Number.isFinite) && start >= 0 && end > start && timeline >= 0;
    });
  });
};

const safeId = (id: string) => /^[A-Za-z0-9_-]{1,80}$/.test(id);

export class EditorProjects {
  private ctx: Context;
  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  async handle(req: IncomingMessage, res: ServerResponse, p: string[]): Promise<boolean> {
    if (p[0] !== 'editor-projects') return false;
    const takeId = p[1];
    if (p.length !== 2 || !takeId || !safeId(takeId)) throw new HttpError(404, 'Not found');
    const db = this.ctx.db;
    const row = () => db.prepare('SELECT * FROM editor_projects WHERE take_id = ?').get(takeId) as StoredProject | undefined;

    if (req.method === 'GET') {
      const found = row();
      json(
        res,
        200,
        found
          ? { project: JSON.parse(found.value), revision: found.revision, updatedAt: found.updated_at }
          : { project: null, revision: 0, updatedAt: null },
      );
      return true;
    }

    if (req.method === 'PUT') {
      const body = await readJson<{ project?: unknown; baseRevision?: number; force?: boolean }>(req, 1 << 20);
      const project = body.project;
      if (!validProject(project, takeId)) throw new HttpError(400, 'Invalid editor project');
      const take = db.prepare('SELECT episode_id FROM takes WHERE id = ?').get(takeId) as { episode_id: string } | undefined;
      if (!take || take.episode_id !== project.episodeId) throw new HttpError(404, 'No such take');
      const found = row();
      const base = Number(body.baseRevision);
      const expected = found?.revision ?? 0;
      if (!body.force && (!Number.isInteger(base) || base !== expected)) {
        json(res, 409, {
          error: 'Project changed elsewhere',
          project: found ? JSON.parse(found.value) : null,
          revision: expected,
          updatedAt: found?.updated_at ?? null,
        });
        return true;
      }
      const revision = expected + 1;
      const updatedAt = Date.now();
      const value = JSON.stringify(project);
      db.prepare(
        `INSERT INTO editor_projects (take_id, episode_id, value, revision, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(take_id) DO UPDATE SET episode_id = excluded.episode_id,
           value = excluded.value, revision = excluded.revision, updated_at = excluded.updated_at`,
      ).run(takeId, project.episodeId, value, revision, updatedAt);
      json(res, 200, { revision, updatedAt });
      return true;
    }

    throw new HttpError(404, 'Not found');
  }
}
