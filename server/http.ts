/* Small helpers for the API: JSON replies, bodies with a size limit, cookies. */
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** A 5 s segment is at most 48 kHz × 24-bit × 2 channels × 5 s ≈ 1.4 MB; leave room. */
export const SEGMENT_LIMIT = 8 << 20;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const json = (res: ServerResponse, status: number, body?: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body === undefined ? '' : JSON.stringify(body));
};

/** The whole body, refusing anything over `limit` bytes. */
export function readBody(req: IncomingMessage, limit = 1 << 20): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Too large'));
        req.resume();
        return;
      }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

export async function readJson<T = Record<string, unknown>>(req: IncomingMessage, limit = 1 << 20): Promise<T> {
  const raw = String(await readBody(req, limit));
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, 'Bad JSON');
  }
}

/**
 * Stream a body to `file` without holding it in memory: written to a temporary
 * file and renamed into place once complete, so a reader never sees half a file.
 * Refuses empty bodies and anything over `limit`. Resolves with the size.
 */
export function streamToFile(req: IncomingMessage, file: string, limit: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tmp = `${file}.part-${randomUUID()}`;
    if (Number(req.headers['content-length'] ?? 0) > limit) { req.resume(); reject(new HttpError(413, 'Too large')); return; }
    const out = createWriteStream(tmp);
    let size = 0;
    let failed = false;
    const fail = (err: Error) => {
      if (failed) return;
      failed = true;
      req.unpipe(out);
      out.destroy();
      rm(tmp, { force: true }).finally(() => reject(err));
    };
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        fail(new HttpError(413, 'Too large'));
        req.resume();
      }
    });
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', async () => {
      if (failed) return;
      if (!size) return fail(new HttpError(400, 'Empty body'));
      try {
        await rename(tmp, file);
        resolve(size);
      } catch (err) {
        fail(err as Error);
      }
    });
    req.pipe(out);
  });
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(res: ServerResponse, name: string, value: string, o: { maxAge?: number; secure?: boolean } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (o.maxAge != null) parts.push(`Max-Age=${o.maxAge}`);
  if (o.secure !== false) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [String(prev)] : []), parts.join('; ')]);
}

/** Where the request came from, behind Caddy. */
export const clientIp = (req: IncomingMessage) =>
  String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '';

/** A fixed-window limit per key: at most `max` hits per `windowMs`. */
export class RateLimit {
  private hits = new Map<string, { n: number; until: number }>();
  private max: number;
  private windowMs: number;
  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }
  /** Counts a hit; false when over the limit. */
  hit(key: string, now = Date.now()) {
    const h = this.hits.get(key);
    if (!h || now > h.until) {
      this.hits.set(key, { n: 1, until: now + this.windowMs });
      if (this.hits.size > 10000) for (const [k, v] of this.hits) if (now > v.until) this.hits.delete(k);
      return true;
    }
    h.n++;
    return h.n <= this.max;
  }
  /** Over the limit already, without counting a hit. */
  blocked(key: string, now = Date.now()) {
    const h = this.hits.get(key);
    return !!h && now <= h.until && h.n >= this.max;
  }
  reset(key: string) {
    this.hits.delete(key);
  }
}
