import { and, eq } from "drizzle-orm";
import { db, people, shows } from "@podstudio/db";

// What the social renderers need about the show beyond the episode list: the
// website (for the "Domain" wordmark and "Listen at …" line) and the host's name
// (credited under pull quotes). Kept server-side like the other db helpers.
export function getSocialBrandInfo() {
  const show = db.select({ id: shows.id, website: shows.website }).from(shows).get();
  if (!show) return { website: null, host: null };
  const host = db
    .select({ name: people.name })
    .from(people)
    .where(and(eq(people.showId, show.id), eq(people.role, "host")))
    .get();
  return { website: show.website, host: host?.name ?? null };
}
