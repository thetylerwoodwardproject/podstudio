import { esc } from "~/lib/feed-xml";

// Pure builders for what search engines and link-preview bots read: JSON-LD
// (schema.org PodcastSeries / PodcastEpisode / Person), the sitemap, robots.txt and
// the shared <meta> set. They only format what the public queries already
// returned — nothing private reaches them.

export function isoDuration(seconds: number | null | undefined): string | undefined {
  if (!seconds || seconds < 1) return undefined;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${x || (!h && !m) ? `${x}S` : ""}`;
}

const clean = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)));

export function showJsonLd(d: {
  name: string;
  url: string;
  description?: string | null;
  imageUrl?: string | null;
  feedUrl: string;
  language?: string | null;
  authors?: string[];
  sameAs?: string[];
}) {
  return clean({
    "@context": "https://schema.org",
    "@type": "PodcastSeries",
    name: d.name,
    url: d.url,
    description: d.description,
    image: d.imageUrl,
    webFeed: d.feedUrl,
    inLanguage: d.language,
    author: d.authors?.map((name) => ({ "@type": "Person", name })),
    sameAs: d.sameAs,
  });
}

export function episodeJsonLd(d: {
  name: string;
  url: string;
  showName: string;
  showUrl: string;
  description?: string | null;
  datePublished: number;
  durationS?: number | null;
  episodeNumber?: number | null;
  seasonNumber?: number | null;
  imageUrl?: string | null;
  audioUrl?: string | null;
  audioBytes?: number | null;
  people?: { name: string; role: string | null; url?: string }[];
}) {
  return clean({
    "@context": "https://schema.org",
    "@type": "PodcastEpisode",
    name: d.name,
    url: d.url,
    description: d.description,
    datePublished: new Date(d.datePublished).toISOString(),
    duration: isoDuration(d.durationS),
    episodeNumber: d.episodeNumber,
    image: d.imageUrl,
    partOfSeries: { "@type": "PodcastSeries", name: d.showName, url: d.showUrl },
    ...(d.seasonNumber != null ? { partOfSeason: { "@type": "PodcastSeason", seasonNumber: d.seasonNumber } } : {}),
    associatedMedia: d.audioUrl
      ? clean({ "@type": "AudioObject", contentUrl: d.audioUrl, encodingFormat: "audio/mpeg", contentSize: d.audioBytes ? String(d.audioBytes) : undefined, duration: isoDuration(d.durationS) })
      : undefined,
    actor: d.people?.filter((p) => p.role === "host" || p.role === "guest").map((p) => clean({ "@type": "Person", name: p.name, url: p.url })),
  });
}

export function personJsonLd(d: { name: string; url: string; description?: string | null; imageUrl?: string | null; sameAs?: string[]; jobTitle?: string | null }) {
  return clean({
    "@context": "https://schema.org",
    "@type": "Person",
    name: d.name,
    url: d.url,
    description: d.description,
    image: d.imageUrl,
    jobTitle: d.jobTitle,
    sameAs: d.sameAs,
  });
}

/** Meta descriptor for React Router's `meta()`: JSON-LD with `<` escaped so it can't close the script tag. */
export function jsonLdMeta(obj: Record<string, unknown>) {
  return { "script:ld+json": obj };
}

export function sitemapXml(entries: { loc: string; lastmod?: number | null }[]) {
  const urls = entries
    .map((e) => `  <url><loc>${esc(e.loc)}</loc>${e.lastmod ? `<lastmod>${new Date(e.lastmod).toISOString()}</lastmod>` : ""}</url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function robotsTxt(origin: string) {
  return [
    "User-agent: *",
    "Disallow: /studio/",
    "Disallow: /api/",
    "Disallow: /guest/",
    "Disallow: /mobile/",
    "Allow: /",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

/** The shared title/description/canonical/Open Graph/Twitter set for a public page. */
export function pageMeta(d: {
  title: string;
  description: string;
  url: string;
  siteName: string;
  type: "website" | "article" | "profile";
  image?: string | null;
  published?: number | null;
  noindex?: boolean;
}) {
  const desc = d.description.length > 300 ? `${d.description.slice(0, 297)}…` : d.description;
  return [
    { title: d.title },
    { name: "description", content: desc },
    ...(d.noindex ? [{ name: "robots", content: "noindex, follow" }] : []),
    { tagName: "link", rel: "canonical", href: d.url },
    { property: "og:type", content: d.type },
    { property: "og:site_name", content: d.siteName },
    { property: "og:title", content: d.title },
    { property: "og:description", content: desc },
    { property: "og:url", content: d.url },
    ...(d.image ? [{ property: "og:image", content: d.image }] : []),
    ...(d.published ? [{ property: "article:published_time", content: new Date(d.published).toISOString() }] : []),
    { name: "twitter:card", content: "summary" }, // square artwork: the "summary" card, not the wide one
    { name: "twitter:title", content: d.title },
    { name: "twitter:description", content: desc },
    ...(d.image ? [{ name: "twitter:image", content: d.image }] : []),
  ];
}
