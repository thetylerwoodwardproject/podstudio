import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from './api.ts';
import { base32Decode, totpAt } from './auth.ts';
import { loadConfig } from './config.ts';
import { createContext } from './context.ts';

/** The API on a random port, over a fresh data folder; pages answer "page". */
async function serve() {
  const data = mkdtempSync(join(tmpdir(), 'podstudio-test-'));
  const ctx = createContext(loadConfig({ PODSTUDIO_DATA: data }));
  const api = createApi(ctx);
  const server = createServer((req, res) => api.handle(req, res, () => res.end('page')));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let cookie = '';
  const call = async (path: string, o: { method?: string; body?: unknown; keep?: boolean } = {}) => {
    const res = await fetch(base + path, {
      method: o.method ?? (o.body ? 'POST' : 'GET'),
      headers: { ...(o.body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: o.body ? JSON.stringify(o.body) : undefined,
      redirect: 'manual',
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [name, value] = pair.split('=');
      const jar = new Map(cookie ? cookie.split('; ').map((x) => x.split('=') as [string, string]) : []);
      if (value) jar.set(name, value);
      else jar.delete(name);
      cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {}
    return { status: res.status, body, location: res.headers.get('location') };
  };
  const done = () => {
    server.closeAllConnections();
    server.close();
    ctx.db.close();
    rmSync(data, { recursive: true, force: true });
  };
  return { call, done, base, setCookie: (c: string) => (cookie = c), getCookie: () => cookie };
}

const codeFor = (secret: string, offset = 0) => totpAt(base32Decode(secret), Math.floor(Date.now() / 30000) + offset);

test('first run: account, two-factor, then signed in all the way', async () => {
  const s = await serve();
  try {
    assert.equal((await s.call('/')).location, '/setup/account');
    assert.equal((await s.call('/api/auth/state')).body.needsSetup, true);
    assert.equal((await s.call('/api/auth/setup', { body: { username: 'tyler', password: 'short' } })).status, 400);
    const setup = await s.call('/api/auth/setup', { body: { username: 'tyler', password: 'the transmitter arrived' } });
    assert.equal(setup.body.next, '/setup/two-factor');
    // A second account can't be made this way.
    assert.equal((await s.call('/api/auth/setup', { body: { username: 'eve', password: 'eve eve eve eve' } })).status, 409);

    // Until two-factor is on, only its setup page opens.
    assert.equal((await s.call('/episodes/142/studio')).location, '/setup/two-factor');
    assert.equal((await s.call('/api/sessions', { body: { episodeId: '142' } })).status, 401);
    const start = await s.call('/api/auth/totp/start', { body: {} });
    const secret = String(start.body.secret).replace(/ /g, '');
    assert.match(String(start.body.svg), /^<svg/);
    assert.equal((await s.call('/api/auth/totp/confirm', { body: { code: '000000' } })).status, 401);
    const confirm = await s.call('/api/auth/totp/confirm', { body: { code: codeFor(secret) } });
    assert.equal((confirm.body.recoveryCodes as string[]).length, 10);

    assert.equal((await s.call('/episodes/142/studio')).status, 200);
    const session = await s.call('/api/sessions', { body: { episodeId: '142' } });
    assert.match(String((session.body.codes as { guest: string }).guest), /^\d{6}$/);
  } finally {
    s.done();
  }
});

test('sign in: password, then a code; recovery codes work once; trusted devices skip the code', async () => {
  const s = await serve();
  try {
    await s.call('/api/auth/setup', { body: { username: 'tyler', password: 'the transmitter arrived' } });
    const secret = String((await s.call('/api/auth/totp/start', { body: {} })).body.secret).replace(/ /g, '');
    const codes = (await s.call('/api/auth/totp/confirm', { body: { code: codeFor(secret) } })).body.recoveryCodes as string[];
    await s.call('/api/auth/signout', { body: {} });
    assert.equal((await s.call('/episodes/142/studio')).location, '/signin?next=%2Fepisodes%2F142%2Fstudio');

    assert.equal((await s.call('/api/auth/signin', { body: { username: 'tyler', password: 'wrong password!' } })).status, 401);
    assert.equal((await s.call('/api/auth/signin', { body: { username: 'nobody', password: 'wrong password!' } })).status, 401);
    const signin = await s.call('/api/auth/signin', { body: { username: 'TYLER', password: 'the transmitter arrived' } });
    assert.equal(signin.body.next, '/signin/verify');
    assert.equal((await s.call('/')).location, '/signin/verify', 'halfway: only the code page');
    assert.equal((await s.call('/api/sessions', { body: { episodeId: '1' } })).status, 401);

    // A recovery code, with the device trusted.
    assert.equal((await s.call('/api/auth/verify', { body: { code: codes[0], trust: true } })).status, 200);
    assert.equal((await s.call('/')).status, 200);
    assert.equal(((await s.call('/api/auth/security')).body.recovery as { unused: number }).unused, 9);

    // Signed out, the trusted device goes straight in.
    await s.call('/api/auth/signout', { body: {} });
    assert.equal((await s.call('/api/auth/signin', { body: { username: 'tyler', password: 'the transmitter arrived' } })).body.next, '/');
    // The same recovery code again doesn't work.
    s.setCookie('');
    await s.call('/api/auth/signin', { body: { username: 'tyler', password: 'the transmitter arrived' } });
    assert.equal((await s.call('/api/auth/verify', { body: { code: codes[0] } })).status, 401);
    assert.equal((await s.call('/api/auth/verify', { body: { code: codeFor(secret, 1) } })).status, 200, 'the next app code');
  } finally {
    s.done();
  }
});

test('too many wrong passwords are slowed down', async () => {
  const s = await serve();
  try {
    await s.call('/api/auth/setup', { body: { username: 'tyler', password: 'the transmitter arrived' } });
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await s.call('/api/auth/signin', { body: { username: 'tyler', password: `wrong ${i} xxxxxx` } })).status;
    assert.equal(last, 429);
  } finally {
    s.done();
  }
});

test('changing the password signs out other browsers', async () => {
  const s = await serve();
  try {
    await s.call('/api/auth/setup', { body: { username: 'tyler', password: 'the transmitter arrived' } });
    const secret = String((await s.call('/api/auth/totp/start', { body: {} })).body.secret).replace(/ /g, '');
    await s.call('/api/auth/totp/confirm', { body: { code: codeFor(secret) } });
    const first = s.getCookie();
    s.setCookie('');
    await s.call('/api/auth/signin', { body: { username: 'tyler', password: 'the transmitter arrived' } });
    await s.call('/api/auth/verify', { body: { code: codeFor(secret, 1) } });
    assert.equal((await s.call('/api/auth/password', { body: { current: 'the transmitter arrived', password: 'a whole new password' } })).status, 200);
    assert.equal((await s.call('/')).status, 200, 'this browser stays in');
    s.setCookie(first);
    assert.equal((await s.call('/')).location, '/signin', 'the other is signed out');
  } finally {
    s.done();
  }
});

test('changes from another site are refused', async () => {
  const s = await serve();
  try {
    const { status } = await (async () => {
      const res = await fetch(`${s.base}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
      return { status: res.status };
    })();
    assert.equal(status, 403);
  } finally {
    s.done();
  }
});
