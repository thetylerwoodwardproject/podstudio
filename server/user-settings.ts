/*
 * Each person's settings (lib/settings.ts), kept on the server so they follow
 * them to any browser. The browser keeps a copy and sends changes; the newest
 * copy wins. Stored as the JSON the browser sends; the browser checks and
 * fills it in when it loads it.
 *
 *   GET /api/me/settings            {settings: {...} | null, updatedAt}
 *   PUT /api/me/settings {settings} {updatedAt}
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from './context.ts';
import { HttpError, json, readJson } from './http.ts';

const LIMIT = 256 << 10;

export class UserSettings {
  private ctx: Context;
  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  get(userId: number): { settings: Record<string, unknown> | null; updatedAt: number } {
    const row = this.ctx.db.prepare('SELECT value, updated_at FROM user_settings WHERE user_id = ?').get(userId) as { value: string; updated_at: number } | undefined;
    return row ? { settings: JSON.parse(row.value), updatedAt: row.updated_at } : { settings: null, updatedAt: 0 };
  }

  put(userId: number, settings: unknown): number {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new HttpError(400, 'Settings must be an object');
    const now = Date.now();
    this.ctx.db
      .prepare('INSERT INTO user_settings (user_id, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(userId, JSON.stringify(settings), now);
    return now;
  }

  async handle(req: IncomingMessage, res: ServerResponse, userId: number): Promise<void> {
    if (req.method === 'GET') return json(res, 200, this.get(userId));
    if (req.method === 'PUT') {
      const body = await readJson<{ settings?: unknown }>(req, LIMIT);
      return json(res, 200, { updatedAt: this.put(userId, body.settings) });
    }
    throw new HttpError(405, 'Use GET or PUT');
  }
}
