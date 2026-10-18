import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

// One SQLite file on a local server volume, per BUILD_PLAN §2. WAL + busy_timeout
// + foreign_keys + synchronous=NORMAL so the web and worker processes can share it
// without stepping on each other during short write transactions.
const DB_PATH = process.env.PODSTUDIO_DB_PATH ?? "/data/podstudio.db";

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("synchronous = NORMAL");

export const db = drizzle(sqlite, { schema });
export { sqlite };
