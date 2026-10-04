/*
 * Accounts: first-run setup, sign-in with a password and a second factor
 * (TOTP, or a one-time recovery code), trusted devices, sign-out, and who's
 * signed in for the rest of the server. Two-factor is required for every
 * account: until it's on, a signed-in browser can only finish setting it up.
 *
 * A signed-in browser holds a random `ps_session` cookie; only its hash is
 * stored. `verified` is 0 between the password and the code.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import qrcode from 'qrcode-generator';
import {
  hashPassword,
  newRecoveryCodes,
  newToken,
  newTotpSecret,
  normalizeRecovery,
  passwordProblem,
  sha256,
  totpUri,
  verifyPassword,
  verifyTotp,
} from './auth.ts';
import type { Context } from './context.ts';
import { tx } from './db.ts';
import { HttpError, RateLimit, clientIp, cookies, json, readJson, setCookie } from './http.ts';
import { clearSetupToken, setupTokenOk, setupTokenRequired } from './setup-token.ts';

export const SESSION_COOKIE = 'ps_session';
export const TRUST_COOKIE = 'ps_trust';
const DAY = 86_400_000;
/** "Keep this device signed in": 30 days, renewed as it's used. Otherwise 12 hours. */
const REMEMBER_MS = 30 * DAY;
const SHORT_MS = 12 * 3_600_000;
const TRUST_MS = 30 * DAY;

export interface User {
  id: number;
  username: string;
  totp: boolean;
}

/** Who a request is from: nobody, halfway through sign-in, or signed in. */
export interface Who {
  user: User | null;
  /** Password and second factor both done */
  verified: boolean;
  /** No account exists yet: first-run setup */
  needsSetup: boolean;
}

interface UserRow {
  id: number;
  username: string;
  pass_hash: string;
  totp_secret: string | null;
  /** A new authenticator being set up; the current one stays on until it's confirmed */
  totp_pending: string | null;
  totp_enabled: number;
  totp_last_step: number;
  totp_added_at: number | null;
}

const deviceLabel = (ua = '') => {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
};

export class Accounts {
  private ctx: Context;
  private signins = new RateLimit(10, 15 * 60_000);
  private codes = new RateLimit(10, 15 * 60_000);
  private setupLimit = new RateLimit(10, 15 * 60_000);

  constructor(ctx: Context) {
    this.ctx = ctx;
  }
  private get db() {
    return this.ctx.db;
  }

  needsSetup() {
    return !this.db.prepare('SELECT 1 FROM users LIMIT 1').get();
  }

  private userRow(id: number) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }
  private toUser(r: UserRow): User {
    return { id: r.id, username: r.username, totp: !!r.totp_enabled };
  }

  /** Who a request is from, from its session cookie. Renews a remembered session as it's used. */
  who(req: IncomingMessage): Who {
    const needsSetup = this.needsSetup();
    const token = cookies(req)[SESSION_COOKIE];
    if (!token) return { user: null, verified: false, needsSetup };
    const now = Date.now();
    const s = this.db.prepare('SELECT user_id, verified, expires_at, created_at, last_seen FROM auth_sessions WHERE id_hash = ?').get(sha256(token)) as
      | { user_id: number; verified: number; expires_at: number; created_at: number; last_seen: number }
      | undefined;
    if (!s || s.expires_at < now) return { user: null, verified: false, needsSetup };
    const u = this.userRow(s.user_id);
    if (!u) return { user: null, verified: false, needsSetup };
    if (now - s.last_seen > 60_000) {
      // A remembered session (longer than 12 h) slides forward; a short one doesn't.
      const remembered = s.expires_at - s.created_at > SHORT_MS + 60_000;
      this.db.prepare('UPDATE auth_sessions SET last_seen = ?, expires_at = ? WHERE id_hash = ?').run(now, remembered ? now + REMEMBER_MS : s.expires_at, sha256(token));
    }
    return { user: this.toUser(u), verified: !!s.verified, needsSetup };
  }

  /** Signed in all the way, with two-factor on: allowed to use the studio. */
  allowed(req: IncomingMessage) {
    const w = this.who(req);
    return !!w.user && w.verified && w.user.totp;
  }

  private startSession(res: ServerResponse, req: IncomingMessage, userId: number, verified: boolean, remember: boolean) {
    const token = newToken();
    const now = Date.now();
    const ms = remember ? REMEMBER_MS : SHORT_MS;
    this.db
      .prepare('INSERT INTO auth_sessions (id_hash, user_id, verified, created_at, last_seen, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sha256(token), userId, verified ? 1 : 0, now, now, now + ms, String(req.headers['user-agent'] ?? '').slice(0, 300));
    setCookie(res, SESSION_COOKIE, token, remember ? { maxAge: ms / 1000 } : {});
  }

  private sessionHash(req: IncomingMessage) {
    const token = cookies(req)[SESSION_COOKIE];
    return token ? sha256(token) : null;
  }

  private trusted(req: IncomingMessage, userId: number) {
    const t = cookies(req)[TRUST_COOKIE];
    if (!t) return false;
    const row = this.db.prepare('SELECT expires_at FROM trusted_devices WHERE token_hash = ? AND user_id = ?').get(sha256(t), userId) as { expires_at: number } | undefined;
    if (!row || row.expires_at < Date.now()) return false;
    this.db.prepare('UPDATE trusted_devices SET last_used = ? WHERE token_hash = ?').run(Date.now(), sha256(t));
    return true;
  }

  /** Check a second-factor code (6 digits, or a recovery code) for a user; uses it up. */
  private checkCode(u: UserRow, code: string): boolean {
    if (!u.totp_secret) return false;
    const digits = code.replace(/\s/g, '');
    if (/^\d{6}$/.test(digits)) {
      const step = verifyTotp(u.totp_secret, digits, Date.now(), u.totp_last_step);
      if (step == null) return false;
      this.db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, u.id);
      return true;
    }
    const rc = normalizeRecovery(code);
    if (rc.length !== 8) return false;
    const hit = this.db.prepare('SELECT id FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL').get(u.id, sha256(rc)) as { id: number } | undefined;
    if (!hit) return false;
    this.db.prepare('UPDATE recovery_codes SET used_at = ? WHERE id = ?').run(Date.now(), hit.id);
    return true;
  }

  private issueRecoveryCodes(userId: number): string[] {
    const codes = newRecoveryCodes();
    tx(this.db, () => {
      this.db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
      const ins = this.db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)');
      for (const c of codes) ins.run(userId, sha256(normalizeRecovery(c)));
    });
    return codes;
  }

  private require(req: IncomingMessage, { verified = true, totp = true } = {}): UserRow {
    const w = this.who(req);
    if (!w.user) throw new HttpError(401, 'Sign in first');
    if (verified && !w.verified) throw new HttpError(401, 'Enter your code first');
    if (totp && !w.user.totp) throw new HttpError(403, 'Turn on two-factor authentication first');
    return this.userRow(w.user.id)!;
  }

  /** /api/auth/*; false for anything else. */
  async handle(req: IncomingMessage, res: ServerResponse, p: string[]): Promise<boolean> {
    if (p[0] !== 'auth') return false;
    const action = p.slice(1).join('/');
    const post = req.method === 'POST';

    if (req.method === 'GET' && action === 'state') {
      const w = this.who(req);
      json(res, 200, { needsSetup: w.needsSetup, setupToken: w.needsSetup && setupTokenRequired(this.ctx.config.data) ? 'required' : null, user: w.user, verified: w.verified });
      return true;
    }

    // First run: the admin account. Only while there are no accounts at all,
    // and with the one-time setup link's token (server/setup-token.ts).
    if (post && action === 'setup') {
      const { username, password, token } = await readJson<{ username?: string; password?: string; token?: string }>(req);
      if (!this.setupLimit.hit(clientIp(req))) throw new HttpError(429, 'Too many tries. Wait a few minutes.');
      if (!setupTokenOk(this.ctx.config.data, token))
        throw new HttpError(403, 'Open the setup link that install.sh printed. Lost it? Run sudo cat /var/lib/podstudio/setup-token on the server.');
      const name = String(username ?? '').trim();
      if (!/^[a-z0-9._-]{2,32}$/i.test(name)) throw new HttpError(400, 'Use 2–32 letters, numbers, dots, dashes or underscores');
      const problem = passwordProblem(String(password ?? ''));
      if (problem) throw new HttpError(400, problem);
      const hash = await hashPassword(String(password));
      const id = tx(this.db, () => {
        if (!this.needsSetup()) throw new HttpError(409, 'This server already has an account. Sign in instead.');
        return Number(this.db.prepare('INSERT INTO users (username, pass_hash, created_at) VALUES (?, ?, ?)').run(name, hash, Date.now()).lastInsertRowid);
      });
      clearSetupToken(this.ctx.config.data);
      // Signed in with the password; two-factor comes next.
      this.startSession(res, req, id, true, false);
      json(res, 200, { next: '/setup/two-factor' });
      return true;
    }

    if (post && action === 'signin') {
      const { username, password, remember } = await readJson<{ username?: string; password?: string; remember?: boolean }>(req);
      const key = `${clientIp(req)}|${String(username ?? '').toLowerCase()}`;
      if (!this.signins.hit(key)) throw new HttpError(429, 'Too many tries. Wait 15 minutes and try again.');
      const u = this.db.prepare('SELECT * FROM users WHERE username = ?').get(String(username ?? '')) as UserRow | undefined;
      // The same work and the same answer whether or not the account exists.
      const ok = u ? await verifyPassword(String(password ?? ''), u.pass_hash) : (await hashPassword('x'), false);
      if (!u || !ok) throw new HttpError(401, 'That username and password don’t match');
      this.signins.reset(key);
      const skip = !u.totp_enabled || this.trusted(req, u.id);
      this.startSession(res, req, u.id, skip, !!remember);
      json(res, 200, { next: !u.totp_enabled ? '/setup/two-factor' : skip ? '/' : '/signin/verify' });
      return true;
    }

    // The second factor at sign-in: a code from the app, or a recovery code.
    if (post && action === 'verify') {
      const u = this.require(req, { verified: false, totp: true });
      const { code, trust } = await readJson<{ code?: string; trust?: boolean }>(req);
      if (!this.codes.hit(`${u.id}`)) throw new HttpError(429, 'Too many tries. Wait 15 minutes and try again.');
      if (!this.checkCode(u, String(code ?? ''))) throw new HttpError(401, 'That code didn’t work. Check the time on your phone, or use a recovery code.');
      this.codes.reset(`${u.id}`);
      this.db.prepare('UPDATE auth_sessions SET verified = 1 WHERE id_hash = ?').run(this.sessionHash(req));
      if (trust) {
        const t = newToken();
        const now = Date.now();
        this.db
          .prepare('INSERT INTO trusted_devices (token_hash, user_id, label, created_at, last_used, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(sha256(t), u.id, deviceLabel(req.headers['user-agent']), now, now, now + TRUST_MS);
        setCookie(res, TRUST_COOKIE, t, { maxAge: TRUST_MS / 1000 });
      }
      json(res, 200, { next: '/' });
      return true;
    }

    // Setting up the authenticator: a new secret, kept aside until it's confirmed
    // with a code. A reset never turns two-factor off in between: walking away
    // halfway would leave the account behind a password alone.
    if (post && action === 'totp/start') {
      const u = this.require(req, { verified: true, totp: false });
      if (u.totp_enabled) {
        // Resetting it needs the current code (from Settings → Security).
        const { code } = await readJson<{ code?: string }>(req);
        if (!this.checkCode(u, String(code ?? ''))) throw new HttpError(401, 'Enter a current code to reset two-factor');
      }
      const secret = newTotpSecret();
      this.db.prepare('UPDATE users SET totp_pending = ? WHERE id = ?').run(secret, u.id);
      const uri = totpUri(secret, u.username);
      const qr = qrcode(0, 'M');
      qr.addData(uri);
      qr.make();
      json(res, 200, { secret: secret.replace(/(.{4})/g, '$1 ').trim(), uri, svg: qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) });
      return true;
    }
    if (post && action === 'totp/confirm') {
      const u = this.require(req, { verified: true, totp: false });
      const { code } = await readJson<{ code?: string }>(req);
      if (!u.totp_pending) throw new HttpError(400, 'Start two-factor setup first');
      if (!this.codes.hit(`${u.id}`)) throw new HttpError(429, 'Too many tries. Wait 15 minutes and try again.');
      const step = verifyTotp(u.totp_pending, String(code ?? ''), Date.now());
      if (step == null) throw new HttpError(401, 'That code didn’t work. Check the time on your phone and try the next one.');
      this.db
        .prepare('UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled = 1, totp_last_step = ?, totp_added_at = ? WHERE id = ?')
        .run(step, Date.now(), u.id);
      // Every other browser has to sign in again with the new authenticator.
      this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND id_hash != ?').run(u.id, this.sessionHash(req));
      this.db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(u.id);
      json(res, 200, { recoveryCodes: this.issueRecoveryCodes(u.id), next: '/setup/domain' });
      return true;
    }

    if (post && action === 'signout') {
      const h = this.sessionHash(req);
      if (h) this.db.prepare('DELETE FROM auth_sessions WHERE id_hash = ?').run(h);
      setCookie(res, SESSION_COOKIE, '', { maxAge: 0 });
      json(res, 200, { next: '/signin' });
      return true;
    }

    // Settings → Security
    if (req.method === 'GET' && action === 'security') {
      const u = this.require(req);
      const unused = (this.db.prepare('SELECT count(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL').get(u.id) as { n: number }).n;
      const total = (this.db.prepare('SELECT count(*) AS n FROM recovery_codes WHERE user_id = ?').get(u.id) as { n: number }).n;
      const devices = this.db.prepare('SELECT token_hash AS id, label, created_at, last_used FROM trusted_devices WHERE user_id = ? AND expires_at > ? ORDER BY last_used DESC').all(u.id, Date.now());
      json(res, 200, { username: u.username, totpAddedAt: u.totp_added_at, recovery: { unused, total }, devices });
      return true;
    }
    if (post && action === 'recovery-codes') {
      const u = this.require(req);
      json(res, 200, { recoveryCodes: this.issueRecoveryCodes(u.id) });
      return true;
    }
    if (req.method === 'DELETE' && p[1] === 'devices' && p[2]) {
      const u = this.require(req);
      this.db.prepare('DELETE FROM trusted_devices WHERE user_id = ? AND token_hash = ?').run(u.id, p[2]);
      json(res, 200, {});
      return true;
    }
    if (post && action === 'password') {
      const u = this.require(req);
      const { current, password } = await readJson<{ current?: string; password?: string }>(req);
      if (!(await verifyPassword(String(current ?? ''), u.pass_hash))) throw new HttpError(401, 'Your current password isn’t right');
      const problem = passwordProblem(String(password ?? ''));
      if (problem) throw new HttpError(400, problem);
      this.db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(await hashPassword(String(password)), u.id);
      // Signed out everywhere else.
      this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND id_hash != ?').run(u.id, this.sessionHash(req));
      json(res, 200, {});
      return true;
    }
    throw new HttpError(404, 'Not found');
  }
}
