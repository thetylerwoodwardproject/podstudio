import { eq, desc, sql } from "drizzle-orm";
import { db, shows, episodes } from "@podstudio/db";

// Server-only — same reasoning as storage.server.ts/episodes.server.ts: no
// @podstudio/db access in feed-overview.tsx itself, so nothing from its
// schema module (which has module-eval-time side effects) can leak into
// that route's client bundle. See CHANGELOG, "Real bug: two sidebar links
// silently failed to navigate."
export function getFeedOverview() {
  const show = db.select().from(shows).get();
  if (!show) return null;

  const recent = db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      status: episodes.status,
      visibility: episodes.visibility,
      durationS: episodes.durationS,
      updatedAt: episodes.updatedAt,
    })
    .from(episodes)
    .where(eq(episodes.showId, show.id))
    .orderBy(desc(episodes.updatedAt))
    .limit(5)
    .all();

  const statusCounts = db
    .select({ status: episodes.status, n: sql<number>`count(*)` })
    .from(episodes)
    .where(eq(episodes.showId, show.id))
    .groupBy(episodes.status)
    .all();

  return { show, recent, statusCounts };
}
