import { and, asc, eq } from "drizzle-orm";
import { db, shows, showTxtRecords, podrollItems, people } from "@podstudio/db";
import { buildFeed } from "~/lib/feed-xml";

// Server-only — gathers the stored show data for `/{show-slug}/feed`. Nothing
// private is read: no unpublished episodes (there are no items at all yet),
// no storage keys. See feed-xml.ts for what is deliberately omitted.
export function getFeedXml(slug: string, origin: string): string | null {
  const show = db.select().from(shows).where(eq(shows.slug, slug)).get();
  if (!show) return null;

  const tags = (show.podcastTags && typeof show.podcastTags === "object" ? show.podcastTags : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);

  const txt = db
    .select({ purpose: showTxtRecords.purpose, value: showTxtRecords.value })
    .from(showTxtRecords)
    .where(eq(showTxtRecords.showId, show.id))
    .orderBy(asc(showTxtRecords.createdAt))
    .all();

  const podroll = db
    .select({ feedGuid: podrollItems.feedGuid, feedUrl: podrollItems.feedUrl, title: podrollItems.title })
    .from(podrollItems)
    .where(eq(podrollItems.showId, show.id))
    .orderBy(asc(podrollItems.position))
    .all();

  const hosts = db
    .select({ name: people.name })
    .from(people)
    .where(and(eq(people.showId, show.id), eq(people.role, "host")))
    .all()
    .map((h) => h.name);

  const fundingUrl = str(tags.fundingUrl);
  // A lock whose unlock window has lapsed is locked again, even before a
  // worker job records it.
  const locked = !!show.locked || (show.unlockedUntil != null && show.unlockedUntil <= Date.now());

  return buildFeed({
    title: show.title,
    link: show.website || `${origin}/${show.slug}`,
    selfUrl: `${origin}/${show.slug}/feed`,
    description: show.description || show.title,
    language: show.language,
    explicit: !!show.explicit,
    podcastGuid: show.podcastGuid,
    locked,
    ownerEmail: show.ownerEmail,
    txt,
    funding: fundingUrl ? { url: fundingUrl, message: str(tags.fundingMessage) } : null,
    medium: str(tags.medium),
    updateFrequency: str(tags.updateFrequency),
    license: str(tags.license),
    hosts,
    podroll,
    items: [],
  });
}
