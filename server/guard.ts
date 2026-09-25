/*
 * Which pages need an account. Pages are built ahead of time and served as
 * files, so this runs in front of them (in server/api.ts), not in Astro:
 * nobody signed in goes to /signin, halfway through sign-in to the code, and
 * an account without two-factor to setting it up. The data is guarded again
 * at the API.
 */
import type { Who } from './accounts.ts';

/** Pages anyone can open: signing in, and the guest and producer side of a session. */
const PUBLIC = [/^\/signin(\/|$)/, /^\/join(\/|$)/, /^\/guest(\/|$)/, /^\/producer(\/|$)/, /^\/unsupported(\/|$)/];

/** A page (not a script, style, font, image, worklet or model file). */
export const isPage = (method: string | undefined, path: string) =>
  (method === 'GET' || method === 'HEAD') && !path.startsWith('/api/') && !path.startsWith('/_astro/') && !/\.[a-z0-9]+$/i.test(path);

/** Where to send this page request instead, or null to serve it. */
export function redirectFor(path: string, who: Who, search = ''): string | null {
  const p = path.replace(/\/+$/, '') || '/';
  const back = `?next=${encodeURIComponent(p + search)}`;
  if (who.needsSetup) return p === '/setup/account' || PUBLIC.some((r) => r.test(p)) ? null : '/setup/account';
  if (p === '/setup/account' || p === '/setup') return who.user ? '/setup/two-factor' : '/signin';
  if (!who.user) return PUBLIC.some((r) => r.test(p)) ? null : `/signin${p === '/' ? '' : back}`;
  if (!who.verified) return p === '/signin/verify' || (PUBLIC.some((r) => r.test(p)) && !p.startsWith('/signin')) ? null : '/signin/verify';
  if (!who.user.totp) return p === '/setup/two-factor' || (PUBLIC.some((r) => r.test(p)) && !p.startsWith('/signin')) ? null : '/setup/two-factor';
  if (p.startsWith('/signin')) return '/';
  return null;
}
