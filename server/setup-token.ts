/*
 * One-time setup link. On a fresh server nobody has an account yet, so
 * whoever opened the site first could make themselves admin. The production
 * server (server/main.ts) writes a random token to <data>/setup-token while
 * there are no accounts; creating the admin account needs it, and it's deleted
 * once that's done. install.sh prints the link; `npm run setup-link` prints it
 * again. Dev and tests never write one, so setup there needs no token.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const tokenFile = (data: string) => join(data, 'setup-token');

/** The token, creating it if there's none yet. Only call while no account exists. */
export function ensureSetupToken(data: string): string {
  const file = tokenFile(data);
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const token = randomBytes(18).toString('base64url');
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

/** Whether setup needs a token at all (a token file exists). */
export const setupTokenRequired = (data: string) => existsSync(tokenFile(data));

/** True when no token is required, or `given` matches it. */
export function setupTokenOk(data: string, given: unknown): boolean {
  const file = tokenFile(data);
  if (!existsSync(file)) return true;
  const hash = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(hash(readFileSync(file, 'utf8').trim()), hash(String(given ?? '').trim()));
}

export const clearSetupToken = (data: string) => rmSync(tokenFile(data), { force: true });

/** The link to print: the public origin if it's set, else a path. */
export const setupLink = (origin: string | null, token: string) => `${origin ?? ''}/setup/account?token=${token}`;
