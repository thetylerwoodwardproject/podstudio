import { and, eq, desc, sql } from "drizzle-orm";
import { db, shows, episodes, assets } from "@podstudio/db";
import { getFeedXml } from "~/lib/feed-data.server";
import { checkFeed } from "~/lib/feed-check";

// Server-only — same reasoning as storage.server.ts/episodes.server.ts: no
// @podstudio/db access in feed-overview.tsx itself, so nothing from its
// schema module (which has module-eval-time side effects) can leak into
// that route's client bundle. See CHANGELOG, "Real bug: two sidebar links
// silently failed to navigate."
export function getFeedOverview(origin: string) {
  const show = db.select().from(shows).get();
  if (!show) return null;

  const feedUrl = `${origin}/${show.slug}/feed`;
  const xml = getFeedXml(show.slug, origin) ?? "";
  const check = checkFeed(xml);

  // Exactly what getFeedXml turns into <item>s: published + public + verified audio.
  const inFeed = db
    .select({
      id: episodes.id,
      number: episodes.number,
      season: episodes.season,
      title: episodes.title,
      durationS: assets.durationS,
      bytes: assets.bytes,
      date: sql<number>`coalesce(${episodes.publishAt}, ${episodes.createdAt})`,
    })
    .from(episodes)
    .innerJoin(assets, and(eq(assets.id, episodes.audioAssetId), eq(assets.status, "verified")))
    .where(and(eq(episodes.showId, show.id), eq(episodes.status, "published"), eq(episodes.visibility, "public")))
    .orderBy(desc(sql`coalesce(${episodes.publishAt}, ${episodes.createdAt})`))
    .all();

  const total = db.select({ n: sql<number>`count(*)` }).from(episodes).where(eq(episodes.showId, show.id)).get()?.n ?? 0;

  return {
    show: { title: show.title, slug: show.slug },
    feedUrl,
    feedBytes: Buffer.byteLength(xml),
    lastEpisodeAt: inFeed[0]?.date ?? null,
    check,
    inFeed,
    notInFeed: total - inFeed.length,
  };
}
