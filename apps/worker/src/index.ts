// Interim worker, NOT the durable job runner Stage 00 asks for (atomic claims,
// leases/heartbeats, abandoned-job recovery, idempotency keys, backoff — that needs
// its own `jobs` table, BUILD_PLAN §4). What it does today: a heartbeat, and the
// scheduled-publish tick. Publishing is a single idempotent state transition on the
// episodes table, so it needs no job queue: a missed tick or a restart just
// publishes late, and a double run publishes nothing twice.
import { sqlite } from "@podstudio/db";
import { publishDueEpisodes } from "@podstudio/db/scheduler";

const TICK_MS = 15_000;
const HEARTBEAT_EVERY = 4; // ticks

console.log(`[worker] started — scheduled-publish check every ${TICK_MS / 1000}s`);

const warned = new Set<string>();
let ticks = 0;

function tick() {
  try {
    const { published, blocked } = publishDueEpisodes(sqlite);
    for (const id of published) console.log(`[worker] published scheduled episode ${id}`);
    for (const id of blocked) {
      if (warned.has(id)) continue;
      warned.add(id);
      console.warn(`[worker] episode ${id} is due but has no verified audio — left scheduled`);
    }
    if (ticks++ % HEARTBEAT_EVERY === 0) console.log("[worker] alive, db reachable");
  } catch (err) {
    console.error("[worker] tick failed:", err);
  }
}

tick();
const timer = setInterval(tick, TICK_MS);

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    clearInterval(timer);
    sqlite.close();
    process.exit(0);
  });
}
