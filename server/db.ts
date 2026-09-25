/*
 * The database: one SQLite file in the data folder, through Node's built-in
 * node:sqlite (no database server, no dependency). WAL mode, foreign keys on,
 * and numbered migrations applied in order at start.
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { migrations } from './migrations.ts';

export type Db = DatabaseSync;

export function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db: Db) {
  db.exec('CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, at INTEGER NOT NULL)');
  const done = new Set((db.prepare('SELECT id FROM migrations').all() as { id: number }[]).map((r) => r.id));
  migrations.forEach((sql, i) => {
    const id = i + 1;
    if (done.has(id)) return;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO migrations (id, at) VALUES (?, ?)').run(id, Date.now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${id} failed: ${(err as Error).message}`);
    }
  });
}

/** The database file in a data folder. */
export const dbFile = (data: string) => join(data, 'podstudio.db');

/** Run `fn` in a transaction. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
