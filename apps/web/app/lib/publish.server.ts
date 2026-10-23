import { desc, eq, ne } from "drizzle-orm";
import { db, shows, episodes, episodePeople, people } from "@podstudio/db";
import { zonedToUtcMs } from "~/lib/item-xml";

// Server-only — see CHANGELOG, "Real bug: two sidebar links silently failed
// to navigate." Publishing for real needs the feed audio file uploaded and
// verified (Stage 02) — "The episode only appears in the feed after every file
// is uploaded and checked" — so "publish now" is deliberately not offered.
// Scheduling (status "scheduled" + publishAt) and unscheduling are real.
export function listPublishable() {
  const show = db.select({ id: shows.id }).from(shows).get();
  if (!show) return [];
  return db
    .select({ id: episodes.id, number: episodes.number, title: episodes.title, status: episodes.status })
    .from(episodes)
    .where(eq(episodes.showId, show.id))
    .orderBy(desc(episodes.number))
    .all()
    .filter((e) => e.status !== "published");
}

export function getPublishData(id: string) {
  const episode = db.select().from(episodes).where(eq(episodes.id, id)).get();
  if (!episode) return null;
  const show = db.select({ timezone: shows.timezone }).from(shows).where(eq(shows.id, episode.showId)).get();
  const credits = db
    .select({ name: people.name, role: episodePeople.role })
    .from(episodePeople)
    .innerJoin(people, eq(people.id, episodePeople.personId))
    .where(eq(episodePeople.episodeId, episode.id))
    .all();
  return { episode, credits, timezone: show?.timezone ?? "UTC" };
}

export function scheduleEpisode(id: string, local: string): { ok: true } | { ok: false; error: string } {
  const data = getPublishData(id);
  if (!data) return { ok: false, error: "Episode not found." };
  const { episode, timezone } = data;
  if (episode.status === "published") return { ok: false, error: "This episode is already published." };
  if (episode.status === "recording") return { ok: false, error: "Finish recording and editing before scheduling." };

  const at = zonedToUtcMs(local, timezone);
  if (at == null) return { ok: false, error: "Enter a valid date and time." };
  if (at <= Date.now()) return { ok: false, error: "Pick a time in the future." };

  db.update(episodes).set({ status: "scheduled", publishAt: at, updatedAt: Date.now() }).where(eq(episodes.id, id)).run();
  return { ok: true };
}

export function unscheduleEpisode(id: string): { ok: true } | { ok: false; error: string } {
  const episode = db.select({ status: episodes.status }).from(episodes).where(eq(episodes.id, id)).get();
  if (!episode) return { ok: false, error: "Episode not found." };
  if (episode.status !== "scheduled") return { ok: false, error: "This episode isn't scheduled." };
  db.update(episodes).set({ status: "editing", publishAt: null, updatedAt: Date.now() }).where(eq(episodes.id, id)).run();
  return { ok: true };
}
