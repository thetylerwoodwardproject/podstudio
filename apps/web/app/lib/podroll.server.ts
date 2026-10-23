import { and, asc, eq } from "drizzle-orm";
import { db, shows, podrollItems } from "@podstudio/db";

// Server-only — see CHANGELOG, "Real bug: two sidebar links silently failed
// to navigate." Manual entry only: Podcast Index search/verification isn't
// integrated (needs an API key — Stage 11), so `verifiedAt` stays null and the
// screen says "unverified". The "Show on public page" switch lives at
// `shows.settings.podroll.showOnPublicPage`.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function settingsOf(raw: unknown) {
  return (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
}

export function getPodroll() {
  const show = db.select({ id: shows.id, title: shows.title, settings: shows.settings }).from(shows).get();
  if (!show) return null;
  const items = db
    .select({
      id: podrollItems.id,
      feedGuid: podrollItems.feedGuid,
      feedUrl: podrollItems.feedUrl,
      title: podrollItems.title,
      note: podrollItems.note,
      verifiedAt: podrollItems.verifiedAt,
    })
    .from(podrollItems)
    .where(eq(podrollItems.showId, show.id))
    .orderBy(asc(podrollItems.position))
    .all();
  const podroll = settingsOf(settingsOf(show.settings).podroll);
  return { items, showOnPublicPage: podroll.showOnPublicPage === true };
}

export function addPodrollItem(input: {
  title: string;
  feedGuid: string;
  feedUrl: string;
  note: string;
}): { ok: true } | { ok: false; error: string } {
  const show = db.select({ id: shows.id, podcastGuid: shows.podcastGuid }).from(shows).get();
  if (!show) return { ok: false, error: "No show seeded yet." };

  const title = input.title.trim();
  const feedGuid = input.feedGuid.trim().toLowerCase();
  const feedUrl = input.feedUrl.trim();
  const note = input.note.trim();

  if (!title) return { ok: false, error: "A title is required." };
  if (title.length > 200) return { ok: false, error: "Title must be 200 characters or fewer." };
  // README: "Reject shows without a podcast:guid."
  if (!feedGuid) return { ok: false, error: "A podcast:guid is required — shows without one can't be added." };
  if (!UUID.test(feedGuid)) return { ok: false, error: "podcast:guid must be a UUID, like 917393e3-1b1e-5cef-ace4-edaa54e1f810." };
  if (feedGuid === show.podcastGuid.toLowerCase()) return { ok: false, error: "That's this show's own GUID." };
  if (feedUrl) {
    try {
      const u = new URL(feedUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    } catch {
      return { ok: false, error: "Feed URL must be a valid http(s) URL." };
    }
  }
  if (note.length > 500) return { ok: false, error: "Note must be 500 characters or fewer." };

  const existing = db
    .select({ id: podrollItems.id })
    .from(podrollItems)
    .where(and(eq(podrollItems.showId, show.id), eq(podrollItems.feedGuid, feedGuid)))
    .get();
  if (existing) return { ok: false, error: "That show is already on the podroll." };

  const last = db
    .select({ position: podrollItems.position })
    .from(podrollItems)
    .where(eq(podrollItems.showId, show.id))
    .orderBy(asc(podrollItems.position))
    .all()
    .at(-1);

  db.insert(podrollItems)
    .values({
      id: crypto.randomUUID(),
      showId: show.id,
      feedGuid,
      feedUrl: feedUrl || null,
      title,
      note: note || null,
      position: (last?.position ?? -1) + 1,
    })
    .run();
  return { ok: true };
}

export function removePodrollItem(id: string) {
  db.delete(podrollItems).where(eq(podrollItems.id, id)).run();
}

export function movePodrollItem(id: string, direction: "up" | "down") {
  const show = db.select({ id: shows.id }).from(shows).get();
  if (!show) return;
  const items = db
    .select()
    .from(podrollItems)
    .where(eq(podrollItems.showId, show.id))
    .orderBy(asc(podrollItems.position))
    .all();
  const index = items.findIndex((i) => i.id === id);
  const swap = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swap < 0 || swap >= items.length) return;
  const [a, b] = [items[index], items[swap]];
  db.update(podrollItems).set({ position: b.position }).where(eq(podrollItems.id, a.id)).run();
  db.update(podrollItems).set({ position: a.position }).where(eq(podrollItems.id, b.id)).run();
}

export function setShowPodrollOnPublicPage(value: boolean) {
  const show = db.select({ id: shows.id, settings: shows.settings }).from(shows).get();
  if (!show) return;
  const settings = settingsOf(show.settings);
  db.update(shows)
    .set({ settings: { ...settings, podroll: { ...settingsOf(settings.podroll), showOnPublicPage: value } } })
    .where(eq(shows.id, show.id))
    .run();
}
