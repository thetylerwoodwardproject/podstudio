/*
 * Account primitives with node:crypto only: scrypt password hashes, TOTP
 * two-factor codes (RFC 6238, what authenticator apps use), one-time recovery
 * codes, and random session tokens stored as hashes.
 */
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (password: string, salt: Buffer, len: number, o: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, len, o, (err, key) => (err ? reject(err) : resolve(key))));

// ── Passwords ─────────────────────────────────────────────────────────────────

const N = 1 << 15;
const R = 8;
const P = 1;
const KEYLEN = 64;

/** "scrypt$N$r$p$salt$hash", base64. About 50 ms and 32 MB per check. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 << 20 });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 << 20 });
  return key.length === want.length && timingSafeEqual(key, want);
}

/** Rules for a new password: long enough to matter, not absurdly long. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters';
  if (password.length > 200) return 'That’s too long';
  return null;
}

// ── TOTP (RFC 6238: HMAC-SHA1, 30 s steps, 6 digits) ─────────────────────────

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret for an authenticator app (160 bits, base32). */
export const newTotpSecret = () => base32Encode(randomBytes(20));

/** The code for a time step (counter = seconds / 30). */
export function totpAt(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/**
 * Check a code against now, allowing one step either side for clock drift.
 * Returns the step it matched (to refuse the same code twice), or null.
 */
export function verifyTotp(secretB32: string, code: string, now = Date.now(), lastStep = -1): number | null {
  const c = code.replace(/\D/g, '');
  if (c.length !== 6) return null;
  const secret = base32Decode(secretB32);
  const step = Math.floor(now / 30000);
  for (const s of [step, step - 1, step + 1]) {
    if (s <= lastStep) continue;
    const want = Buffer.from(totpAt(secret, s));
    if (timingSafeEqual(want, Buffer.from(c))) return s;
  }
  return null;
}

/** What an authenticator app scans. */
export const totpUri = (secret: string, account: string, issuer = 'Podstudio') =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// ── Recovery codes and tokens ─────────────────────────────────────────────────

const RC = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Ten one-time codes like "k7m2-xq4p", for when the phone is lost. */
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const s = [...b].map((x) => RC[x % RC.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}
export const normalizeRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** A random token for a cookie; only its hash is stored. */
export const newToken = () => randomBytes(32).toString('base64url');
