import { eq, sql } from "drizzle-orm";
import { db, shows, episodes } from "@podstudio/db";

// Server-only: what the studio sidebar's show card shows (one show per install).
export function getShellShow() {
  const show = db.select({ id: shows.id, title: shows.title }).from(shows).get();
  if (!show) return null;
  const n = db.select({ n: sql<number>`count(*)` }).from(episodes).where(eq(episodes.showId, show.id)).get()?.n ?? 0;
  return { title: show.title, episodes: n };
}
