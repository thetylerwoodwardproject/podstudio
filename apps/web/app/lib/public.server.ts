import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, shows, showLinks, people, episodes, episodePeople, podrollItems, assets } from "@podstudio/db";
import { readBrandTheme } from "~/lib/brand-theme";
import { cleanCategory } from "~/lib/podcast-categories";
import { DIRECTORIES, readDirectoryLinks } from "~/lib/directories";
import { likePattern } from "~/lib/search";
import { avatarUrlsFor, isPubliclyListed } from "~/lib/people.server";
import { slugify } from "~/lib/episode-fields";
import { htmlToText, sanitizeRichHtml } from "~/lib/rich-text.server";
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

// Adds who the episode is "with" and the public audio URL (only when a verified MP3
// exists) to a page of episode rows — one query for people, one for audio.
function withGuestsAndAudio<T extends { id: string; publicId: string }>(slug: string, rows: T[]) {
  if (rows.length === 0) return [] as (T & { guests: string[]; guestPeople: { id: string; name: string; slug: string }[]; audioSrc: string | null })[];
  const ids = rows.map((r) => r.id);
  const guests = db
    .select({ episodeId: episodePeople.episodeId, personId: people.id, name: people.name })
    .from(episodePeople)
    .innerJoin(people, eq(people.id, episodePeople.personId))
    .where(and(inArray(episodePeople.episodeId, ids), eq(episodePeople.role, "guest")))
    .all();
  const withAudio = new Set(
    db
      .select({ id: episodes.id })
      .from(episodes)
      .innerJoin(assets, and(eq(assets.id, episodes.audioAssetId), eq(assets.status, "verified")))
      .where(inArray(episodes.id, ids))
      .all()
      .map((r) => r.id),
  );
  return rows.map((r) => ({
    ...r,
    description: htmlToText((r as { description?: string | null }).description) || null,
    guests: guests.filter((g) => g.episodeId === r.id).map((g) => g.name),
    guestPeople: guests
      .filter((g) => g.episodeId === r.id)
      .map((g) => ({ id: g.personId, name: g.name, slug: slugify(g.name) })),
    audioSrc: withAudio.has(r.id) ? `/${slug}/media/${r.publicId}/episode.mp3` : null,
  }));
}

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
  const cat = cleanCategory(tags.category, tags.subcategory);
  const settings = (show.settings && typeof show.settings === "object" ? show.settings : {}) as Record<string, unknown>;
  const dirLinks = readDirectoryLinks(settings.directories);
  return {
    directories: DIRECTORIES.filter((d) => dirLinks[d.id]).map((d) => ({ id: d.id, label: d.label, url: dirLinks[d.id]! })),
    slug: show.slug,
    category: cat ? (cat.sub ?? cat.primary) : null,
    author: str(tags.author),
    artworkUrl: art ? `/${show.slug}/artwork/${artworkFile(art)}` : null,
    title: show.title,
    description: htmlToText(show.description) || null,
    descriptionHtml: sanitizeRichHtml(show.description),
    website: show.website,
    feedUrl: show.feedUrl,
    language: show.language,
    updateFrequency: str(tags.updateFrequency),
    fundingUrl: str(tags.fundingUrl),
    fundingMessage: str(tags.fundingMessage),
    brand: readBrandTheme(show.theme),
  };
}

// Layout-level data for every public page (header/footer chrome): the show header
// and its visible social links. 404 for an unknown show.
export function getPublicShell(slug: string) {
  const show = findShow(slug);
  if (!show) return null;
  const links = db
    .select({ platform: showLinks.platform, value: showLinks.value })
    .from(showLinks)
    .where(and(eq(showLinks.showId, show.id), eq(showLinks.visible, 1)))
    .orderBy(showLinks.position)
    .all();
  return { show: showHeader(show), links };
}

export function getPublicShowPage(slug: string, page: number, pageSize = 10, q = "") {
  const show = findShow(slug);
  if (!show) return null;
  const query = q.trim().slice(0, 100);
  const where = query
    ? and(
        PUBLIC_EPISODE(show.id),
        or(
          sql`${episodes.title} like ${likePattern(query)} escape '\\'`,
          sql`${episodes.subtitle} like ${likePattern(query)} escape '\\'`,
          sql`${episodes.description} like ${likePattern(query)} escape '\\'`,
        ),
      )
    : PUBLIC_EPISODE(show.id);
  const since = db
    .select({ first: sql<number | null>`min(${PUBLIC_DATE})` })
    .from(episodes)
    .where(PUBLIC_EPISODE(show.id))
    .get()?.first;

  const total = db.select({ n: sql<number>`count(*)` }).from(episodes).where(where).get()?.n ?? 0;
  const allTotal = query
    ? (db.select({ n: sql<number>`count(*)` }).from(episodes).where(PUBLIC_EPISODE(show.id)).get()?.n ?? 0)
    : total;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);

  const list = db
    .select(episodeColumns)
    .from(episodes)
    .where(where)
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

  const hostRows = db
    .select({ id: people.id, name: people.name, bio: people.bio })
    .from(people)
    .where(and(eq(people.showId, show.id), eq(people.role, "host")))
    .orderBy(people.name)
    .all();
  const hostAvatars = avatarUrlsFor(show.slug, hostRows.map((h) => h.id));
  const hosts = hostRows.map((h) => ({ ...h, bio: htmlToText(h.bio) || null, slug: slugify(h.name), avatarUrl: hostAvatars.get(h.id) ?? null }));

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
    latest: latest ? withGuestsAndAudio(show.slug, [latest])[0]! : null,
    episodes: withGuestsAndAudio(show.slug, list),
    total,
    allTotal,
    q: query,
    sinceYear: since ? new Date(since).getUTCFullYear() : null,
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

  const creditRows = db
    .select({ id: people.id, name: people.name, role: episodePeople.role, bio: people.bio })
    .from(episodePeople)
    .innerJoin(people, eq(people.id, episodePeople.personId))
    .where(eq(episodePeople.episodeId, episode.id))
    .all();
  const creditAvatars = avatarUrlsFor(show.slug, creditRows.map((c) => c.id));
  // Everyone credited on a public episode may be shown, so each has a profile page.
  const credits = creditRows.map((c) => ({ ...c, bio: htmlToText(c.bio) || null, slug: slugify(c.name), avatarUrl: creditAvatars.get(c.id) ?? null }));
  const newer = db
    .select({ publicId: episodes.publicId, slug: episodes.slug, title: episodes.title, number: episodes.number })
    .from(episodes)
    .where(and(PUBLIC_EPISODE(show.id), sql`${PUBLIC_DATE} > ${episode.date}`))
    .orderBy(PUBLIC_DATE)
    .limit(1)
    .get();

  // "Up next" = the next-older public episodes, by the same public date order.
  const upNext = db
    .select({
      id: episodes.id,
      publicId: episodes.publicId,
      slug: episodes.slug,
      title: episodes.title,
      number: episodes.number,
      durationS: episodes.durationS,
      date: PUBLIC_DATE,
    })
    .from(episodes)
    .where(and(PUBLIC_EPISODE(show.id), sql`${PUBLIC_DATE} < ${episode.date}`))
    .orderBy(desc(PUBLIC_DATE))
    .limit(3)
    .all();

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
    episode: { ...episode, description: htmlToText(episode.description) || null, descriptionHtml: sanitizeRichHtml(episode.description) },
    credits,
    upNext: withGuestsAndAudio(show.slug, upNext),
    newer: newer ?? null,
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

// ---- people (public profiles) -------------------------------------------------

/** A host or guest profile + the public episodes they're credited on. Null unless they may appear publicly. */
export function getPublicPerson(slug: string, personId: string) {
  const show = findShow(slug);
  const person = db.select().from(people).where(eq(people.id, personId)).get();
  if (!show || !person || person.showId !== show.id) return null;
  if (!isPubliclyListed(person.id, person.role)) return null;

  const rows = db
    .select(episodeColumns)
    .from(episodePeople)
    .innerJoin(episodes, eq(episodes.id, episodePeople.episodeId))
    .where(and(eq(episodePeople.personId, personId), PUBLIC_EPISODE(show.id)))
    .orderBy(desc(PUBLIC_DATE))
    .all();
  const avatars = avatarUrlsFor(show.slug, [personId]);
  return {
    show: showHeader(show),
    person: {
      id: person.id,
      name: person.name,
      slug: slugify(person.name),
      role: person.role,
      bio: htmlToText(person.bio) || null,
      bioHtml: sanitizeRichHtml(person.bio),
      website: person.website,
      avatarUrl: avatars.get(personId) ?? null,
    },
    episodes: withGuestsAndAudio(show.slug, rows),
  };
}

/** Everything crawlers should know about, public data only. */
export function getSitemapEntries(origin: string) {
  const show = db.select().from(shows).get();
  if (!show) return null;
  const base = `${origin}/${show.slug}`;
  const eps = db
    .select({ publicId: episodes.publicId, slug: episodes.slug, updatedAt: episodes.updatedAt, date: PUBLIC_DATE })
    .from(episodes)
    .where(PUBLIC_EPISODE(show.id))
    .orderBy(desc(PUBLIC_DATE))
    .all();
  const everyone = db.select({ id: people.id, name: people.name, role: people.role }).from(people).where(eq(people.showId, show.id)).all();
  const listed = everyone.filter((p) => isPubliclyListed(p.id, p.role));
  const newest = eps[0] ? Math.max(eps[0].updatedAt ?? 0, eps[0].date) : null;
  return [
    { loc: base, lastmod: newest },
    ...eps.map((e) => ({ loc: `${base}/episodes/${e.publicId}/${e.slug}`, lastmod: Math.max(e.updatedAt ?? 0, e.date) })),
    ...listed.map((p) => ({ loc: `${base}/people/${p.id}/${slugify(p.name)}`, lastmod: null as number | null })),
  ];
}
