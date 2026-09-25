/*
 * One server context per process: config, the database and the live rooms.
 * It lives on globalThis so the Astro build (pages and middleware, bundled
 * separately) and server/main.ts share the same instance.
 */
import { loadConfig, type Config } from './config.ts';
import { dbFile, openDb, type Db } from './db.ts';
import { LiveStore } from './live-store.ts';

export interface Context {
  config: Config;
  db: Db;
  live: LiveStore;
}

const KEY = Symbol.for('podstudio.context');
type G = typeof globalThis & { [KEY]?: Context };

export function createContext(config: Config = loadConfig()): Context {
  const db = openDb(dbFile(config.data));
  const ctx: Context = { config, db, live: new LiveStore(db) };
  (globalThis as G)[KEY] = ctx;
  return ctx;
}

/** The running server's context (created at start by main.ts or the dev plugin). */
export function context(): Context {
  return (globalThis as G)[KEY] ?? createContext();
}
