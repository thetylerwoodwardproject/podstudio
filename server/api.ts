/*
 * The Podstudio API: everything under /api/, in front of Astro's pages. The
 * same handler runs in production (server/main.ts) and under `npm run dev`
 * (the Vite plugin in dev/server-plugin.ts).
 */
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Context } from './context.ts';
import { HttpError, json } from './http.ts';
import { LiveRooms } from './live.ts';

export interface Api {
  handle(req: IncomingMessage, res: ServerResponse, next: () => void): void;
  attach(server: Server | null | undefined): void;
  live: LiveRooms;
}

export function createApi(ctx: Context): Api {
  const live = new LiveRooms(ctx);
  const route = async (req: IncomingMessage, res: ServerResponse, url: URL, p: string[]) => {
    if (req.method === 'GET' && p[0] === 'health' && p.length === 1) return json(res, 200, { ok: true, server: 'podstudio', time: Date.now() });
    if (await live.handle(req, res, url, p)) return;
    throw new HttpError(404, 'Not found');
  };
  return {
    live,
    handle(req, res, next) {
      const url = new URL(req.url ?? '/', 'http://x');
      if (!url.pathname.startsWith('/api/') || url.pathname === '/api/ws') return next();
      const p = url.pathname.split('/').filter(Boolean).slice(1);
      route(req, res, url, p).catch((err) => {
        if (res.headersSent) return res.destroy();
        const status = err instanceof HttpError ? err.status : err instanceof SyntaxError ? 400 : 500;
        if (status === 500) console.error(err);
        json(res, status, { error: status === 500 ? 'Server error' : (err as Error).message });
      });
    },
    attach(server) {
      live.attach(server);
    },
  };
}
