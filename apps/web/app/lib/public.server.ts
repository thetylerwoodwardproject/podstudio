import { and, desc, eq, sql } from "drizzle-orm";
import { db, shows, showLinks, people, episodes, episodePeople, podrollItems, assets } from "@podstudio/db";
import { readBrandTheme } from "~/lib/brand-theme";
import { artworkFile, getShowArtwork } from "~/lib/artwork.server";

// Server-only data access for the public pages (25/30) — see CHANGELOG, "Real
// bug: two sidebar links silently failed to navigate." Per README: "Expose
// only public, non-stale published data" and "Do not expose protected
// episodes or assets" — so every episode query here requires status
// "published" AND visibility "public"; unlisted/private/scheduled episodes
// never leave this module. Public identity is the immutable `publicId`, never
// the episode number.
const PUBLIC_EPISODE = (showId: string) =>
  and(eq(episodes.showId, showId), eq(episodes.status, "published"), eq(episodes.visibility, "public"));

const PUBLIC_DATE = sql<number>`coalesce(${episodes.publishAt}, ${episodes.createdAt})`;

const episodeColumns = {
  id: episodes.id,
  publicId: episodes.publicId,
  slug: episodes.slug,
  number: episodes.number,
  season: episodes.season,
  title: episodes.title,
  subtitle: episodes.subtitle,
  description: episodes.description,
  durationS: episodes.durationS,
  hasVideo: episodes.hasVideo,
  date: PUBLIC_DATE,
};

function findShow(slug: string) {
  return db.select().from(shows).where(eq(shows.slug, slug)).get();
}

function showHeader(show: NonNullable<ReturnType<typeof findShow>>) {
  const tags = (show.podcastTags && typeof show.podcastTags === "object" ? show.podcastTags : {}) as Record<
    string,
    unknown
  >;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const art = getShowArtwork();
  return {
    slug: show.slug,
    artworkUrl: art ? `/${show.slug}/artwork/${artworkFile(art)}` : null,
    title: show.title,
    description: show.description,
    website: show.website,
    feedUrl: show.feedUrl,
    language: show.language,
    updateFrequency: str(tags.updateFrequency),
    fundingUrl: str(tags.fundingUrl),
    fundingMessage: str(tags.fundingMessage),
    brand: readBrandTheme(show.theme),
  };
}

export function getPublicShowPage(slug: string, page: number, pageSize = 10) {
  const show = findShow(slug);
  if (!show) return null;

  const total =
    db.select({ n: sql<number>`count(*)` }).from(episodes).where(PUBLIC_EPISODE(show.id)).get()?.n ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);

  const list = db
    .select(episodeColumns)
    .from(episodes)
    .where(PUBLIC_EPISODE(show.id))
    .orderBy(desc(PUBLIC_DATE))
    .limit(pageSize)
    .offset((current - 1) * pageSize)
    .all();

  const latest = db
    .select(episodeColumns)
    .from(episodes)
    .where(PUBLIC_EPISODE(show.id))
    .orderBy(desc(PUBLIC_DATE))
    .limit(1)
    .get();

  const links = db
    .select({ platform: showLinks.platform, value: showLinks.value })
    .from(showLinks)
    .where(and(eq(showLinks.showId, show.id), eq(showLinks.visible, 1)))
    .orderBy(showLinks.position)
    .all();

  const hosts = db
    .select({ name: people.name })
    .from(people)
    .where(and(eq(people.showId, show.id), eq(people.role, "host")))
    .all();

  // "Shows we recommend" — only when the Podroll screen's switch is on; same
  // order as the feed (position).
  const settings = (show.settings && typeof show.settings === "object" ? show.settings : {}) as Record<string, unknown>;
  const podrollSettings = (settings.podroll && typeof settings.podroll === "object" ? settings.podroll : {}) as Record<string, unknown>;
  const recommended =
    podrollSettings.showOnPublicPage === true
      ? db
          .select({ title: podrollItems.title, feedUrl: podrollItems.feedUrl, note: podrollItems.note })
          .from(podrollItems)
          .where(eq(podrollItems.showId, show.id))
          .orderBy(podrollItems.position)
          .all()
      : [];

  return {
    show: showHeader(show),
    links,
    hosts,
    recommended,
    latest: latest ?? null,
    episodes: list,
    total,
    page: current,
    pageCount,
  };
}

export function getPublicEpisodePage(slug: string, publicId: string) {
  const show = findShow(slug);
  if (!show) return null;

  const episode = db
    .select(episodeColumns)
    .from(episodes)
    .where(and(PUBLIC_EPISODE(show.id), eq(episodes.publicId, publicId)))
    .get();
  if (!episode) return null;

  const credits = db
    .select({ name: people.name, role: episodePeople.role })
    .from(episodePeople)
    .innerJoin(people, eq(people.id, episodePeople.personId))
    .where(eq(episodePeople.episodeId, episode.id))
    .all();

  // "Up next" = the next-older public episode, by the same public date order.
  const upNext = db
    .select({ publicId: episodes.publicId, slug: episodes.slug, title: episodes.title, number: episodes.number })
    .from(episodes)
    .where(and(PUBLIC_EPISODE(show.id), sql`${PUBLIC_DATE} < ${episode.date}`))
    .orderBy(desc(PUBLIC_DATE))
    .limit(1)
    .get();

  const links = db
    .select({ platform: showLinks.platform, value: showLinks.value })
    .from(showLinks)
    .where(and(eq(showLinks.showId, show.id), eq(showLinks.visible, 1)))
    .orderBy(showLinks.position)
    .all();

  const audio = db
    .select({ bytes: assets.bytes })
    .from(episodes)
    .innerJoin(assets, and(eq(assets.id, episodes.audioAssetId), eq(assets.status, "verified")))
    .where(eq(episodes.id, episode.id))
    .get();

  return {
    show: showHeader(show),
    links,
    episode,
    credits,
    upNext: upNext ?? null,
    audio: audio ? { src: `/${show.slug}/media/${episode.publicId}/${episode.slug || "episode"}.mp3`, bytes: audio.bytes } : null,
  };
}

// Embed player data (`/{show}/embed/{public-id|latest|all}`) — same public +
// published-only rule as everything above.
export function getEmbedView(slug: string, target: string, origin: string) {
  const show = findShow(slug);
  if (!show) return null;
  const url = (e: { publicId: string; slug: string }) => `${origin}/${show.slug}/episodes/${e.publicId}/${e.slug}`;
  const cols = {
    publicId: episodes.publicId,
    slug: episodes.slug,
    title: episodes.title,
    number: episodes.number,
    audioId: assets.id,
    audioDuration: assets.durationS,
  };
  // Only a *verified* audio asset makes an episode playable; otherwise audioUrl is null.
  const base = () =>
    db
      .select(cols)
      .from(episodes)
      .leftJoin(assets, and(eq(assets.id, episodes.audioAssetId), eq(assets.status, "verified")));
  const shape = (e: { publicId: string; slug: string; title: string; number: number | null; audioId: string | null; audioDuration: number | null }) => ({
    id: e.publicId,
    title: e.title,
    number: e.number,
    url: url(e),
    audioUrl: e.audioId ? `${origin}/${show.slug}/media/${e.publicId}/episode.mp3` : null,
    durationS: e.audioDuration,
  });
  const art = getShowArtwork();
  const artworkUrl = art ? `${origin}/${show.slug}/artwork/${artworkFile(art)}` : null;
  const showUrl = `${origin}/${show.slug}`;

  if (target === "all") {
    const list = base().where(PUBLIC_EPISODE(show.id)).orderBy(desc(PUBLIC_DATE)).limit(50).all();
    return { showTitle: show.title, showUrl, artworkUrl, mode: "playlist" as const, episodes: list.map(shape) };
  }
  const row =
    target === "latest"
      ? base().where(PUBLIC_EPISODE(show.id)).orderBy(desc(PUBLIC_DATE)).limit(1).get()
      : base().where(and(PUBLIC_EPISODE(show.id), eq(episodes.publicId, target))).get();
  if (!row && target !== "latest") return null; // unknown / non-public id -> 404; "latest" with none yet renders empty
  return {
    showTitle: show.title,
    showUrl,
    artworkUrl,
    mode: "single" as const,
    episodes: row ? [shape(row)] : [],
  };
}

/** For oEmbed: resolve a public page URL path to {show slug, optional episode public id}, public episodes only. */
export function resolveOembedTarget(slug: string, publicId: string | null) {
  const show = findShow(slug);
  if (!show) return null;
  if (!publicId) return { title: show.title, target: "latest" as const, slug: show.slug };
  const ep = db
    .select({ title: episodes.title })
    .from(episodes)
    .where(and(PUBLIC_EPISODE(show.id), eq(episodes.publicId, publicId)))
    .get();
  if (!ep) return null;
  return { title: `${ep.title} — ${show.title}`, target: publicId, slug: show.slug };
}
