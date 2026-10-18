// Stub only — NOT the durable job runner Stage 00 asks for (atomic claims via
// BEGIN IMMEDIATE/UPDATE...RETURNING, leases/heartbeats, abandoned-job recovery,
// idempotency keys, bounded concurrency, backoff/cancellation). That needs its own
// `jobs` table (BUILD_PLAN §4) and design pass. This just proves a worker process
// can share the SQLite file with the web app in docker-compose and stay up.
import { sqlite } from "@podstudio/db";

console.log("[worker] stub started — see apps/worker/src/index.ts for what's deferred");

function heartbeat() {
  const row = sqlite.prepare("select datetime('now') as now").get() as { now: string };
  console.log(`[worker] alive, db reachable, server time ${row.now}`);
}

heartbeat();
setInterval(heartbeat, 30_000);

process.on("SIGTERM", () => {
  sqlite.close();
  process.exit(0);
});
