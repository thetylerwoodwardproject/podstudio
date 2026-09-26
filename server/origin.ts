/*
 * Changes (POST, PUT, DELETE) are accepted only from Podstudio's own pages:
 * the browser's Origin header must name this server. "This server" is any of
 *
 *   - the Host the request arrived with,
 *   - the host a proxy says it forwarded (X-Forwarded-Host, Forwarded: host=),
 *     for proxies and tunnels that rewrite Host (ngrok, some Nginx setups),
 *   - each origin in PODSTUDIO_ORIGIN (comma-separated).
 *
 * Trusting the forwarded headers is safe here: this guards against another
 * site's page making the browser send a change, and such a page can't add
 * those headers (a form can't, and fetch would need a CORS preflight this
 * server never answers).
 */
import type { IncomingMessage } from 'node:http';

const hostOf = (value: string) => {
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).host.toLowerCase();
  } catch {
    return '';
  }
};

const first = (h: string | string[] | undefined) => String(Array.isArray(h) ? h[0] : (h ?? '')).split(',')[0].trim();

/** Hosts this request may come from. */
export function allowedHosts(req: IncomingMessage, origins: string[]): string[] {
  const forwarded = /(?:^|[;,\s])host="?([^";,\s]+)/i.exec(first(req.headers.forwarded))?.[1] ?? '';
  const hosts = [first(req.headers.host), first(req.headers['x-forwarded-host']), forwarded, ...origins].map(hostOf).filter(Boolean);
  // Default ports: https://example.com and example.com:443 are the same place.
  return [...new Set(hosts.flatMap((h) => [h, h.replace(/:(443|80)$/, '')]))];
}

/** null when the change is allowed, otherwise the reason to show. */
export function checkOrigin(req: IncomingMessage, origins: string[]): string | null {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return null;
  const origin = first(req.headers.origin);
  if (!origin) return null; // not from a browser page (curl, the CLI)
  const from = hostOf(origin);
  const hosts = allowedHosts(req, origins);
  if (from && hosts.includes(from)) return null;
  return `Not from this server: the page is on ${origin}, but this server answers as ${hosts.join(', ') || 'no address'}. Open Podstudio at its own address, or add ${origin} to PODSTUDIO_ORIGIN.`;
}
