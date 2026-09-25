/*
 * Server settings, from the environment. Everything else (the OpenAI key,
 * the domain) is stored in the database and set from Settings.
 *
 *   PODSTUDIO_DATA    data folder: the database, takes, media (default ./data,
 *                     or .podstudio-dev under `npm run dev`)
 *   PORT / HOST       where to listen (default 4321 on 127.0.0.1: Caddy is in front)
 *   PODSTUDIO_ORIGIN  the public https origin, for checking where requests come from
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface Config {
  data: string;
  port: number;
  host: string;
  origin: string | null;
  dev: boolean;
}

export function loadConfig(env = process.env, dev = false): Config {
  const data = resolve(env.PODSTUDIO_DATA || (dev ? '.podstudio-dev' : 'data'));
  mkdirSync(data, { recursive: true });
  for (const dir of ['takes', 'media', 'live']) mkdirSync(join(data, dir), { recursive: true });
  return {
    data,
    port: Number(env.PORT) || 4321,
    host: env.HOST || '127.0.0.1',
    origin: env.PODSTUDIO_ORIGIN?.replace(/\/$/, '') || null,
    dev,
  };
}
