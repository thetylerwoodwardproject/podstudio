import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, shows, showTxtRecords, podrollItems, people, episodes, episodePeople, assets } from "@podstudio/db";
import { itemXml } from "~/lib/item-xml";
import { buildFeed } from "~/lib/feed-xml";

// Server-only — gathers the stored show data for `/{show-slug}/feed`. Nothing
// private is read: only published + public episodes WITH a verified audio
// asset become items (an item without a working enclosure is invalid), and the
// enclosure URL is the public media route, never a storage key. See feed-xml.ts for what is deliberately omitted.
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

  const published = db
    .select({
      id: episodes.id,
      title: episodes.title,
      guid: episodes.guid,
      guidIsPermalink: episodes.guidIsPermalink,
      publicId: episodes.publicId,
      description: episodes.description,
      season: episodes.season,
      number: episodes.number,
      explicit: episodes.explicit,
      durationS: assets.durationS,
      bytes: assets.bytes,
      date: sql<number>`coalesce(${episodes.publishAt}, ${episodes.createdAt})`,
    })
    .from(episodes)
    .innerJoin(assets, and(eq(assets.id, episodes.audioAssetId), eq(assets.status, "verified")))
    .where(and(eq(episodes.showId, show.id), eq(episodes.status, "published"), eq(episodes.visibility, "public")))
    .orderBy(desc(sql`coalesce(${episodes.publishAt}, ${episodes.createdAt})`))
    .all();
  const items = published.map((e) =>
    itemXml({
      title: e.title,
      guid: e.guid,
      guidIsPermalink: e.guidIsPermalink,
      pubDate: e.date,
      season: e.season,
      number: e.number,
      durationS: e.durationS,
      explicit: !!e.explicit,
      description: e.description,
      people: db
        .select({ name: people.name, role: episodePeople.role })
        .from(episodePeople)
        .innerJoin(people, eq(people.id, episodePeople.personId))
        .where(eq(episodePeople.episodeId, e.id))
        .all(),
      enclosure: { url: `${origin}/${show.slug}/media/${e.publicId}/episode.mp3`, bytes: e.bytes ?? 0 },
    }),
  );

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
    items: items,
  });
}
