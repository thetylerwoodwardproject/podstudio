import { eq } from "drizzle-orm";
import { db, episodes, episodePeople, people, type EpisodeStatus } from "@podstudio/db";

// Server-only, same reasoning as storage.server.ts: route files that import
// @podstudio/db values directly (even only inside loader/action) risk
// pulling drizzle-orm's runtime into that route's client bundle if anything
// in the same file also uses a db-exported value client-side — which is
// exactly what broke navigation to this screen (episode-detail.tsx rendered
// `episodeStatus.map(...)` straight from @podstudio/db). Keeping all db
// access here, with episode-detail.tsx importing nothing from @podstudio/db,
// removes that risk entirely rather than relying on the bundler to notice
// nothing client-side needs it.
export function getEpisodeWithCredits(id: string) {
  const episode = db.select().from(episodes).where(eq(episodes.id, id)).get();
  if (!episode) return null;

  const credits = db
    .select({ id: people.id, name: people.name, role: episodePeople.role })
    .from(episodePeople)
    .innerJoin(people, eq(people.id, episodePeople.personId))
    .where(eq(episodePeople.episodeId, episode.id))
    .all();

  return { episode, credits };
}

export function deleteEpisode(id: string) {
  db.delete(episodePeople).where(eq(episodePeople.episodeId, id)).run();
  db.delete(episodes).where(eq(episodes.id, id)).run();
}

export function updateEpisode(
  id: string,
  fields: {
    title: string;
    subtitle: string | null;
    description: string | null;
    status: EpisodeStatus;
    visibility: "private" | "unlisted" | "public";
  },
) {
  db.update(episodes)
    .set({ ...fields, updatedAt: Date.now() })
    .where(eq(episodes.id, id))
    .run();
}
