/*
 * The Podstudio API: everything under /api/, in front of Astro's pages. The
 * same handler runs in production (server/main.ts) and under `npm run dev`
 * (the Vite plugin in dev/server-plugin.ts). It also guards pages (guard.ts).
 */
import { statfsSync } from 'node:fs';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { Accounts } from './accounts.ts';
import type { Context } from './context.ts';
import { isPage, redirectFor } from './guard.ts';
import { HttpError, json } from './http.ts';
import { LiveRooms } from './live.ts';
import { migrations } from './migrations.ts';
import { checkOrigin } from './origin.ts';
import { UserSettings } from './user-settings.ts';
import pkg from '../package.json' with { type: 'json' };

export interface Api {
  handle(req: IncomingMessage, res: ServerResponse, next: () => void): void;
  attach(server: Server | null | undefined): void;
  live: LiveRooms;
  accounts: Accounts;
}

/** Settings → Server: what's running and how full the data folder's disk is. */
export function serverStatus(ctx: Context) {
  let disk: { total: number; free: number } | null = null;
  try {
    const fs = statfsSync(ctx.config.data);
    disk = { total: fs.blocks * fs.bsize, free: fs.bavail * fs.bsize };
  } catch {}
  return { version: pkg.version, schema: migrations.length, node: process.versions.node, data: ctx.config.data, uptime: Math.round(process.uptime()), disk };
}

export function createApi(ctx: Context): Api {
  const accounts = new Accounts(ctx);
  const live = new LiveRooms(ctx);
  const settings = new UserSettings(ctx);
  // Starting a session with a guest needs the host signed in.
  live.canHost = (req) => accounts.allowed(req);

  const route = async (req: IncomingMessage, res: ServerResponse, url: URL, p: string[]) => {
    if (req.method === 'GET' && p[0] === 'health' && p.length === 1) return json(res, 200, { ok: true, server: 'podstudio', version: pkg.version, schema: migrations.length, time: Date.now() });
    if (await accounts.handle(req, res, p)) return;
    // Guests and producers use their session token, not an account.
    if (await live.handle(req, res, url, p)) return;
    if (!accounts.allowed(req)) throw new HttpError(401, 'Sign in first');
    if (req.method === 'GET' && p[0] === 'server' && p.length === 1) return json(res, 200, serverStatus(ctx));
    if (p[0] === 'me' && p[1] === 'settings' && p.length === 2) return settings.handle(req, res, accounts.who(req).user!.id);
    if (await ctx.library.handle(req, res, url, p)) return;
    if (await ctx.takes.handle(req, res, url, p)) return;
    if (await ctx.editorProjects.handle(req, res, p)) return;
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
      const refused = checkOrigin(req, ctx.config.origins);
      if (refused) {
        console.warn(`Refused ${req.method} ${url.pathname}: origin ${req.headers.origin}, host ${req.headers.host ?? req.headers[':authority'] ?? '-'}, x-forwarded-host ${req.headers['x-forwarded-host'] ?? '-'}`);
        return json(res, 403, { error: refused });
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
