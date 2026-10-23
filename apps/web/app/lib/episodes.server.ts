import { desc, eq } from "drizzle-orm";
import { slugify } from "~/lib/episode-fields";
import { db, episodes, episodePeople, people, shows, type EpisodeStatus } from "@podstudio/db";

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
    season: number | null;
    number: number | null;
    explicit: boolean;
  },
) {
  const { explicit, ...rest } = fields;
  db.update(episodes)
    .set({ ...rest, explicit: explicit ? 1 : 0, updatedAt: Date.now() })
    .where(eq(episodes.id, id))
    .run();
}

// Episodes list (screen 02) — moved here from the route file so that route
// imports nothing from @podstudio/db (the hard rule above).
export function listEpisodeRows() {
  const show = db.select().from(shows).get();
  if (!show) return { show: null, rows: [] };

  const rows = db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      status: episodes.status,
      durationS: episodes.durationS,
      updatedAt: episodes.updatedAt,
    })
    .from(episodes)
    .where(eq(episodes.showId, show.id))
    .orderBy(desc(episodes.number))
    .all();

  const guestByEpisode = new Map<string, string>();
  for (const row of rows) {
    const credits = db
      .select({ name: people.name, role: episodePeople.role })
      .from(episodePeople)
      .innerJoin(people, eq(people.id, episodePeople.personId))
      .where(eq(episodePeople.episodeId, row.id))
      .all();
    const guest = credits.find((c) => c.role === "guest");
    if (guest) guestByEpisode.set(row.id, guest.name);
  }

  return { show, rows: rows.map((r) => ({ ...r, guest: guestByEpisode.get(r.id) ?? null })) };
}

// New episodes get a fresh UUID v4 guid at creation (CLAUDE.md GUID rule) —
// `guidIsPermalink` stays null (attribute absent). `publicId` is its own
// immutable v4, the authoritative public identity (the slug is cosmetic and may
// repeat). Starts as a private "recording" draft: nothing is exposed until
// someone publishes it. Number/season default to the next number and the latest
// episode's season; duplicates are allowed on purpose (trailers, repeated
// season numbering).
export function createEpisode(input: {
  title: string;
  number: number | null;
  season: number | null;
}): { ok: true; id: string } | { ok: false; error: string } {
  const show = db.select({ id: shows.id }).from(shows).get();
  if (!show) return { ok: false, error: "No show seeded yet." };
  const title = input.title.trim();
  if (!title) return { ok: false, error: "A title is required." };
  if (title.length > 200) return { ok: false, error: "Title must be 200 characters or fewer." };

  const latest = db
    .select({ number: episodes.number, season: episodes.season })
    .from(episodes)
    .where(eq(episodes.showId, show.id))
    .orderBy(desc(episodes.number))
    .limit(1)
    .get();

  const id = crypto.randomUUID();
  const now = Date.now();
  db.insert(episodes)
    .values({
      id,
      showId: show.id,
      guid: crypto.randomUUID(),
      guidIsPermalink: null,
      number: input.number ?? (latest?.number ?? 0) + 1,
      season: input.season ?? latest?.season ?? 1,
      title,
      subtitle: null,
      slug: slugify(title),
      publicId: crypto.randomUUID(),
      status: "recording",
      visibility: "private",
      description: null,
      explicit: 0,
      publishAt: null,
      durationS: null,
      hasVideo: 0,
      artworkUrl: null,
      branding: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return { ok: true, id };
}
