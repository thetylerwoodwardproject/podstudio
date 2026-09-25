/*
 * One server context per process: config, the database and the live rooms.
 * It lives on globalThis so the Astro build (pages and middleware, bundled
 * separately) and server/main.ts share the same instance.
 */
import { loadConfig, type Config } from './config.ts';
import { dbFile, openDb, type Db } from './db.ts';
import { Library } from './library.ts';
import { LiveStore } from './live-store.ts';
import { Takes } from './takes.ts';

export interface Context {
  config: Config;
  db: Db;
  live: LiveStore;
  library: Library;
  takes: Takes;
}

const KEY = Symbol.for('podstudio.context');
type G = typeof globalThis & { [KEY]?: Context };

export function createContext(config: Config = loadConfig()): Context {
  const db = openDb(dbFile(config.data));
  const ctx = { config, db, live: new LiveStore(db) } as Context;
  ctx.library = new Library(ctx);
  ctx.takes = new Takes(ctx);
  (globalThis as G)[KEY] = ctx;
  return ctx;
}

/** The running server's context (created at start by main.ts or the dev plugin). */
export function context(): Context {
  return (globalThis as G)[KEY] ?? createContext();
}
