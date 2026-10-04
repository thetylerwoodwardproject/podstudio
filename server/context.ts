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
import { Recordings } from './recordings.ts';
import { AiCredentials } from './ai-credentials.ts';
import { PreparedAudio } from './prepared-audio.ts';
import { EpisodePreparation } from './episode-preparation.ts';
import { EditorProjects } from './editor-projects.ts';

export interface Context {
  config: Config;
  db: Db;
  live: LiveStore;
  library: Library;
  takes: Takes;
  editorProjects: EditorProjects;
  recordings: Recordings;
  aiCredentials: AiCredentials;
  preparedAudio: PreparedAudio;
  preparation: EpisodePreparation;
}

const KEY = Symbol.for('podstudio.context');
type G = typeof globalThis & { [KEY]?: Context };

export function createContext(config: Config = loadConfig()): Context {
  const db = openDb(dbFile(config.data));
  const ctx = { config, db, live: new LiveStore(db) } as Context;
  ctx.library = new Library(ctx);
  ctx.recordings = new Recordings(ctx);
  ctx.aiCredentials = new AiCredentials(ctx);
  ctx.preparedAudio = new PreparedAudio(ctx);
  ctx.preparation = new EpisodePreparation(ctx);
  ctx.takes = new Takes(ctx);
  ctx.editorProjects = new EditorProjects(ctx);
  void ctx.recordings.cleanup().catch(() => console.warn('Recording cleanup will be retried on deletion'));
  (globalThis as G)[KEY] = ctx;
  return ctx;
}

/** The running server's context (created at start by main.ts or the dev plugin). */
export function context(): Context {
  return (globalThis as G)[KEY] ?? createContext();
}
