/* Test helper: the API on a random port over a fresh data folder, signed in with 2FA on. */
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from './api.ts';
import { base32Decode, totpAt } from './auth.ts';
import { loadConfig } from './config.ts';
import { createContext } from './context.ts';

export async function signedIn() {
  const data = mkdtempSync(join(tmpdir(), 'podstudio-lib-'));
  const ctx = createContext(loadConfig({ PODSTUDIO_DATA: data }));
  const api = createApi(ctx);
  const server = createServer((req, res) => api.handle(req, res, () => res.end('page')));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let cookie = '';
  const call = async (path: string, o: { method?: string; body?: unknown; raw?: BodyInit } = {}) => {
    const res = await fetch(base + path, {
      method: o.method ?? (o.body || o.raw ? 'POST' : 'GET'),
      headers: { ...(o.body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: o.raw ?? (o.body ? JSON.stringify(o.body) : undefined),
    });
    const set = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('ps_session='));
    if (set) cookie = set;
    const buf = Buffer.from(await res.arrayBuffer());
    let body: Record<string, any> = {};
    try {
      body = JSON.parse(String(buf));
    } catch {}
    return { status: res.status, body, buf };
  };
  await call('/api/auth/setup', { body: { username: 'tyler', password: 'the transmitter arrived' } });
  const secret = String((await call('/api/auth/totp/start', { body: {} })).body.secret).replace(/ /g, '');
  await call('/api/auth/totp/confirm', { body: { code: totpAt(base32Decode(secret), Math.floor(Date.now() / 30000)) } });
  return {
    call,
    ctx,
    anon: (path: string) => fetch(base + path).then((r) => r.status),
    done: () => {
      server.closeAllConnections();
      server.close();
      ctx.db.close();
      rmSync(data, { recursive: true, force: true });
    },
  };
}

