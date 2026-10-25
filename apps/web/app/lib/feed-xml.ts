import { podrollXml, type PodrollEntry } from "~/lib/podroll-xml";

// Pure RSS builder for `/{show-slug}/feed`. Only writes what the data supports:
// - `podcast:guid` is written exactly as stored — never regenerated or
//   normalized (CLAUDE.md GUID rule).
// - `podcast:locked` always carries the owner email (README 16b).
// - `podcast:value` is omitted: the stored fields (type/method/address) don't
//   include a recipient name or split, so a valid `valueRecipient` can't be
//   built from them honestly.
// - `podcast:trailer` is omitted: it needs a pubdate/length/type that
//   `trailerUrl` alone doesn't carry.
// - Items are passed in already-built (feed-data.server.ts); only episodes with
//   a verified uploaded audio file become items — an item without an
//   `<enclosure>` would make the feed invalid for podcast apps.
export interface FeedInput {
  title: string;
  link: string;
  selfUrl: string;
  description: string;
  language: string;
  explicit: boolean;
  podcastGuid: string;
  locked: boolean;
  ownerEmail: string;
  txt: { purpose: string | null; value: string }[];
  funding: { url: string; message: string | null } | null;
  medium: string | null;
  updateFrequency: string | null;
  license: string | null;
  hosts: string[];
  /** itunes:author — shown by Apple Podcasts under the show title. */
  author?: string | null;
  /** Absolute URL of the verified show artwork (itunes:image). */
  imageUrl?: string | null;
  /** itunes:category — Apple's closed list; sub is nested inside primary. */
  category?: { primary: string; sub: string | null } | null;
  podroll: PodrollEntry[];
  items: string[];
}

export function esc(v: string) {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function indent(block: string, spaces: number) {
  const pad = " ".repeat(spaces);
  return block.split("\n").map((l) => pad + l).join("\n");
}

export function buildFeed(f: FeedInput) {
  const ch: string[] = [
    `<title>${esc(f.title)}</title>`,
    `<link>${esc(f.link)}</link>`,
    `<description>${esc(f.description)}</description>`,
    `<language>${esc(f.language)}</language>`,
    `<atom:link href="${esc(f.selfUrl)}" rel="self" type="application/rss+xml"/>`,
    `<itunes:explicit>${f.explicit ? "true" : "false"}</itunes:explicit>`,
    `<podcast:guid>${esc(f.podcastGuid)}</podcast:guid>`,
    `<podcast:locked owner="${esc(f.ownerEmail)}">${f.locked ? "yes" : "no"}</podcast:locked>`,
  ];
  if (f.author) ch.push(`<itunes:author>${esc(f.author)}</itunes:author>`);
  if (f.imageUrl) ch.push(`<itunes:image href="${esc(f.imageUrl)}"/>`);
  if (f.category) {
    const sub = f.category.sub ? `<itunes:category text="${esc(f.category.sub)}"/>` : "";
    ch.push(
      sub
        ? `<itunes:category text="${esc(f.category.primary)}">${sub}</itunes:category>`
        : `<itunes:category text="${esc(f.category.primary)}"/>`,
    );
  }
  for (const t of f.txt) {
    const purpose = t.purpose ? ` purpose="${esc(t.purpose)}"` : "";
    ch.push(`<podcast:txt${purpose}>${esc(t.value)}</podcast:txt>`);
  }
  if (f.funding) {
    ch.push(`<podcast:funding url="${esc(f.funding.url)}">${esc(f.funding.message ?? "Support the show")}</podcast:funding>`);
  }
  if (f.medium) ch.push(`<podcast:medium>${esc(f.medium)}</podcast:medium>`);
  if (f.updateFrequency) ch.push(`<podcast:updateFrequency>${esc(f.updateFrequency)}</podcast:updateFrequency>`);
  if (f.license) ch.push(`<podcast:license>${esc(f.license)}</podcast:license>`);
  for (const h of f.hosts) ch.push(`<podcast:person role="host">${esc(h)}</podcast:person>`);
  const podroll = podrollXml(f.podroll);
  if (podroll) ch.push(podroll);
  for (const item of f.items) ch.push(item);

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">\n` +
    `  <channel>\n${indent(ch.join("\n"), 4)}\n  </channel>\n</rss>\n`
  );
}
