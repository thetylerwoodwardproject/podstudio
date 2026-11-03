// Library uploads: the same claim/lease/cancel pattern as render jobs, over `library_items`.
import { eq } from "drizzle-orm";
import { db, libraryItems, sqlite } from "@podstudio/db";
import { libraryJob } from "./import-job";
import { Cancelled, LEASE_MS } from "./storage";

const MAX_ATTEMPTS = 3;

function claim(now = Date.now()): typeof libraryItems.$inferSelect | null {
  const take = sqlite.transaction(() => {
    const row = sqlite.prepare(`select id from library_items where status = 'queued' or (status = 'running' and lease_until < ?) order by created_at limit 1`).get(now) as { id: string } | undefined;
    if (!row) return null;
    sqlite.prepare(`update library_items set status='running', lease_until=?, attempts=attempts+1 where id=?`).run(now + LEASE_MS, row.id);
    return row.id;
  });
  const id = take.immediate();
  return id ? (db.select().from(libraryItems).where(eq(libraryItems.id, id)).get() ?? null) : null;
}

export async function runNextLibraryItem(): Promise<boolean> {
  const item = claim();
  if (!item) return false;
  const fail = (msg: string) => db.update(libraryItems).set({ status: "failed", error: msg.slice(0, 500), finishedAt: Date.now(), leaseUntil: null }).where(eq(libraryItems.id, item.id)).run();
  if (item.attempts > MAX_ATTEMPTS) {
    fail("Gave up after the worker restarted several times while converting.");
    return true;
  }
  console.log(`[worker] library item ${item.id} (${item.filename})`);
  try {
    await libraryJob(item);
  } catch (err) {
    const asked = db.select({ c: libraryItems.cancelRequested }).from(libraryItems).where(eq(libraryItems.id, item.id)).get()?.c;
    if (err instanceof Cancelled || asked) {
      db.update(libraryItems).set({ status: "failed", error: "Canceled.", finishedAt: Date.now(), leaseUntil: null }).where(eq(libraryItems.id, item.id)).run();
    } else {
      console.error(`[worker] library item ${item.id} failed:`, err);
      fail(err instanceof Error ? err.message : "Conversion failed");
    }
  }
  return true;
}
