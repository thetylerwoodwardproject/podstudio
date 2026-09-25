/*
 * The Podstudio API: everything under /api/, in front of Astro's pages. The
 * same handler runs in production (server/main.ts) and under `npm run dev`
 * (the Vite plugin in dev/server-plugin.ts). It also guards pages (guard.ts).
 */
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { Accounts } from './accounts.ts';
import type { Context } from './context.ts';
import { isPage, redirectFor } from './guard.ts';
import { HttpError, json } from './http.ts';
import { LiveRooms } from './live.ts';

export interface Api {
  handle(req: IncomingMessage, res: ServerResponse, next: () => void): void;
  attach(server: Server | null | undefined): void;
  live: LiveRooms;
  accounts: Accounts;
}

export function createApi(ctx: Context): Api {
  const accounts = new Accounts(ctx);
  const live = new LiveRooms(ctx);
  // Starting a session with a guest needs the host signed in.
  live.canHost = (req) => accounts.allowed(req);

  const route = async (req: IncomingMessage, res: ServerResponse, url: URL, p: string[]) => {
    if (req.method === 'GET' && p[0] === 'health' && p.length === 1) return json(res, 200, { ok: true, server: 'podstudio', time: Date.now() });
    if (await accounts.handle(req, res, p)) return;
    // Guests and producers use their session token, not an account.
    if (await live.handle(req, res, url, p)) return;
    if (!accounts.allowed(req)) throw new HttpError(401, 'Sign in first');
    if (await ctx.library.handle(req, res, url, p)) return;
    if (await ctx.takes.handle(req, res, url, p)) return;
    throw new HttpError(404, 'Not found');
  };

  return {
    live,
    accounts,
    handle(req, res, next) {
      const url = new URL(req.url ?? '/', 'http://x');
      if (isPage(req.method, url.pathname)) {
        const to = redirectFor(url.pathname, accounts.who(req), url.search);
        if (!to) return next();
        res.statusCode = 302;
        res.setHeader('Location', to);
        res.setHeader('Cache-Control', 'no-store');
        return res.end();
      }
      if (!url.pathname.startsWith('/api/') || url.pathname === '/api/ws') return next();
      const p = url.pathname.split('/').filter(Boolean).slice(1);
      // Changes only from pages on this server (cookies are SameSite=Lax too).
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
        let from = '';
        try {
          from = new URL(req.headers.origin).host;
        } catch {}
        const allowed = [req.headers.host, ctx.config.origin && new URL(ctx.config.origin).host].filter(Boolean);
        if (!allowed.includes(from)) return json(res, 403, { error: 'Not from this server' });
      }
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
