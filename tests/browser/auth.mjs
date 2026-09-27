// Playwright with a signed-in host: the first run makes the account (with 2FA) on the test
// server and saves the session cookie; every new browser context gets it.
import { chromium as base } from 'playwright-core';
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { B, DATA, OUT } from './env.mjs';
const STATE = `${OUT}/auth-state.json`;
export const USER = 'tyler', PASS = 'the transmitter arrived';

const b32 = (s) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, v = 0; const out = []; for (const c of s.replace(/[^A-Z2-7]/gi, '').toUpperCase()) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
export const totp = (secret, offset = 0) => { const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset)); const h = createHmac('sha1', b32(secret)).update(msg).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0'); };

async function call(path, body, cookie) {
  const res = await fetch(B + '/api/' + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('ps_session='));
  return { status: res.status, body: await res.json().catch(() => ({})), cookie: set ?? cookie };
}

export async function session() {
  if (existsSync(STATE)) {
    const s = JSON.parse(readFileSync(STATE, 'utf8'));
    if ((await call('auth/state', null, s.cookie)).body.verified) return s;
  }
  const st = await call('auth/state');
  let s = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
  if (st.body.needsSetup) {
    const a = await call('auth/setup', { username: USER, password: PASS, token: (() => { try { return readFileSync(`${DATA}/setup-token`, 'utf8').trim(); } catch { return ''; } })() });
    const start = await call('auth/totp/start', {}, a.cookie);
    const secret = start.body.secret.replace(/ /g, '');
    await call('auth/totp/confirm', { code: totp(secret) }, a.cookie);
    s = { cookie: a.cookie, secret };
  } else {
    const a = await call('auth/signin', { username: USER, password: PASS, remember: true });
    // A code works once per 30 s step: use the next step's code if this one was used.
    let v = await call('auth/verify', { code: totp(s.secret) }, a.cookie);
    if (v.status !== 200) v = await call('auth/verify', { code: totp(s.secret, 1) }, a.cookie);
    s = { ...s, cookie: a.cookie };
  }
  writeFileSync(STATE, JSON.stringify(s));
  return s;
}

// Each test run starts with Ep. 142 as it ships: example script, solo, no pads.
let reset = false;
async function resetEpisode(cookie) {
  if (reset) return;
  reset = true;
  const put = (path, body, method = 'PUT') => fetch(B + '/api/' + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  await put('episodes/142/script', undefined, 'DELETE');
  await put('episodes/142/setup', {});
  await put('pads/show', []);
  await put('pads/episode/142', []);
}

const signedIn = async (ctx) => {
  const s = await session();
  await resetEpisode(s.cookie);
  const [name, value] = s.cookie.split('=');
  await ctx.addCookies([{ name, value, url: B, secure: true, httpOnly: true, sameSite: 'Lax' }]);
  return ctx;
};
export const chromium = {
  ...base,
  launch: async (o) => {
    const browser = await base.launch(o);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (co) => signedIn(await newContext(co));
    return browser;
  },
};
