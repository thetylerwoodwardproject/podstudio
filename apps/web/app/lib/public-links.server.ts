import { eq, and, asc } from "drizzle-orm";
import { db, shows, showLinks, type ShowLinkPlatform } from "@podstudio/db";
import { DIRECTORIES, normalizeDirectoryUrl, readDirectoryLinks, type DirectoryLinks } from "~/lib/directories";

// Server-only — same hard rule as every other `.server.ts` file this
// session: no @podstudio/db access in public-links.tsx itself, so none of
// it can leak into that route's client bundle. See CHANGELOG, "Real bug:
// two sidebar links silently failed to navigate."
export function getShowWebsite() {
  const show = db.select({ website: shows.website }).from(shows).get();
  return show?.website ?? null;
}

export function listShowLinks() {
  const show = db.select({ id: shows.id }).from(shows).get();
  if (!show) return [];
  return db
    .select({
      id: showLinks.id,
      platform: showLinks.platform,
      value: showLinks.value,
      visible: showLinks.visible,
      position: showLinks.position,
    })
    .from(showLinks)
    .where(eq(showLinks.showId, show.id))
    .orderBy(asc(showLinks.position))
    .all();
}

export function addShowLink(
  platform: ShowLinkPlatform,
  value: string,
): { ok: true } | { ok: false; error: string } {
  const show = db.select({ id: shows.id }).from(shows).get();
  if (!show) return { ok: false, error: "No show seeded yet." };

  const existing = db
    .select()
    .from(showLinks)
    .where(and(eq(showLinks.showId, show.id), eq(showLinks.platform, platform)))
    .get();
  if (existing) return { ok: false, error: `${platform} is already added — remove it first to replace it.` };

  const maxPosition = db
    .select({ position: showLinks.position })
    .from(showLinks)
    .where(eq(showLinks.showId, show.id))
    .orderBy(asc(showLinks.position))
    .all()
    .at(-1)?.position;

  db.insert(showLinks)
    .values({
      id: crypto.randomUUID(),
      showId: show.id,
      platform,
      value,
      visible: 1,
      position: (maxPosition ?? -1) + 1,
    })
    .run();
  return { ok: true };
}

export function removeShowLink(id: string) {
  db.delete(showLinks).where(eq(showLinks.id, id)).run();
}

export function setShowLinkVisible(id: string, visible: boolean) {
  db.update(showLinks).set({ visible: visible ? 1 : 0 }).where(eq(showLinks.id, id)).run();
}

export function moveShowLink(id: string, direction: "up" | "down") {
  const show = db.select({ id: shows.id }).from(shows).get();
  if (!show) return;

  const links = db
    .select()
    .from(showLinks)
    .where(eq(showLinks.showId, show.id))
    .orderBy(asc(showLinks.position))
    .all();

  const index = links.findIndex((l) => l.id === id);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapWith < 0 || swapWith >= links.length) return;

  const a = links[index];
  const b = links[swapWith];
  db.update(showLinks).set({ position: b.position }).where(eq(showLinks.id, a.id)).run();
  db.update(showLinks).set({ position: a.position }).where(eq(showLinks.id, b.id)).run();
}

// "Listen on" directory links live under `directories` in the existing
// `shows.settings` JSON (other keys there — embed, podroll — are preserved).
export function getDirectoryLinks(): DirectoryLinks {
  const show = db.select({ settings: shows.settings }).from(shows).get();
  const settings = (show?.settings && typeof show.settings === "object" ? show.settings : {}) as Record<string, unknown>;
  return readDirectoryLinks(settings.directories);
}

export function saveDirectoryLinks(input: Record<string, string>): { ok: true } | { ok: false; error: string } {
  const show = db.select({ id: shows.id, settings: shows.settings }).from(shows).get();
  if (!show) return { ok: false, error: "No show seeded yet." };
  const next: DirectoryLinks = {};
  for (const d of DIRECTORIES) {
    const r = normalizeDirectoryUrl(d.id, input[d.id] ?? "");
    if (!r.ok) return { ok: false, error: r.error };
    if (r.value) next[d.id] = r.value;
  }
  const settings = (show.settings && typeof show.settings === "object" ? show.settings : {}) as Record<string, unknown>;
  db.update(shows)
    .set({ settings: { ...settings, directories: next } })
    .where(eq(shows.id, show.id))
    .run();
  return { ok: true };
}
