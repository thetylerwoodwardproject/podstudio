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

const numberIn = (n: unknown, low: number, high: number) => typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high;
const validProject = (value: unknown, takeId: string): value is { version: 1; takeId: string; episodeId: string; tracks: unknown[] } => {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  if (p.version !== 1 || p.takeId !== takeId || typeof p.episodeId !== 'string' || !Array.isArray(p.tracks) || p.tracks.length > 64) return false;
  if (p.master != null) {
    if (typeof p.master !== 'object') return false;
    const m = p.master as Record<string, unknown>;
    if (m.loudness != null && !['stereo','mono','off','custom'].includes(String(m.loudness))) return false;
    if (m.targetLufs != null && !numberIn(m.targetLufs, -30, -10)) return false;
    if (m.ceilingDb != null && !numberIn(m.ceilingDb, -3, -.1)) return false;
    if (m.channels != null && m.channels !== 1 && m.channels !== 2) return false;
  }
  if (!p.tracks.every((value) => {
    if (!value || typeof value !== 'object') return false;
    const track = value as Record<string, unknown>;
    if (typeof track.id !== 'string' || typeof track.sourceId !== 'string' || !['voice', 'pads', 'import'].includes(String(track.kind)) || !Array.isArray(track.clips) || track.clips.length > 10_000) return false;
    const fx = track.fx as Record<string, unknown> | undefined;
    if (fx?.tone != null) {
      const tone = fx.tone as { eq?: { gains?: unknown[] }; comp?: Record<string, unknown> };
      if (!Array.isArray(tone?.eq?.gains) || tone.eq.gains.length !== 10 || !tone.eq.gains.every((n) => numberIn(n, -12, 12)) || !tone.comp) return false;
      for (const [key, min, max] of [['threshold', -40, 0], ['ratio', 1, 10], ['knee', 0, 18], ['makeup', 0, 12]] as const) if (!numberIn(tone.comp[key], min, max)) return false;
      if (tone.comp.attackMs != null && !numberIn(tone.comp.attackMs, .1, 100)) return false;
      if (tone.comp.releaseMs != null && !numberIn(tone.comp.releaseMs, 10, 2000)) return false;
    }
    return track.clips.every((value) => {
      if (!value || typeof value !== 'object') return false;
      const clip = value as Record<string, unknown>;
      const start = Number(clip.sourceStart), end = Number(clip.sourceEnd), timeline = Number(clip.timelineStart);
      return typeof clip.id === 'string' && typeof clip.sourceId === 'string' && [start, end, timeline].every(Number.isFinite) && start >= 0 && end > start && timeline >= 0 && (clip.sourceDuration == null || numberIn(clip.sourceDuration, end, Number.MAX_SAFE_INTEGER));
    });
  })) return false;
  if (p.crossfades == null) return true;
  if (!Array.isArray(p.crossfades) || p.crossfades.length > 10_000) return false;
  return p.crossfades.every((value) => {
    if (!value || typeof value !== 'object') return false;
    const f = value as { trackId?: unknown; from?: unknown; to?: unknown };
    if (typeof f.trackId !== 'string' || !Array.isArray(f.from) || !Array.isArray(f.to) || !f.from.length || !f.to.length) return false;
    const track = (p.tracks as { id: string; clips: { id: string; timelineStart: number; sourceStart: number; sourceEnd: number }[] }[]).find((t) => t.id === f.trackId);
    const ids = [...f.from, ...f.to];
    if (!track || new Set(ids).size !== ids.length || !ids.every((id) => typeof id === 'string' && track.clips.some((c) => c.id === id))) return false;
    const bounds = (group: unknown[]) => { const clips = track.clips.filter((c) => group.includes(c.id)); return [Math.min(...clips.map((c) => c.timelineStart)), Math.max(...clips.map((c) => c.timelineStart + c.sourceEnd - c.sourceStart))]; };
    const a = bounds(f.from), b = bounds(f.to);
    return a[0] < b[0] && a[1] < b[1] && b[0] < a[1];
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
