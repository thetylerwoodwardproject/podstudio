// Pure builder for a feed <item>, used by Publish to feed (14)'s read-only
// preview and, later, the feed generator. Only emits what the data actually
// supports: no enclosure/transcript/chapters/soundbite/alternateEnclosure/value
// until the files behind them exist. The guid is written exactly as stored —
// never regenerated or normalized (CLAUDE.md GUID rule) — and
// `isPermaLink` is emitted only when the stored flag is non-null.
export interface ItemInput {
  title: string;
  guid: string;
  guidIsPermalink: number | null;
  pubDate: number | null; // ms
  season: number | null;
  number: number | null;
  durationS: number | null;
  explicit: boolean;
  people: { name: string; role: string | null }[]; // role omitted when unset — never guessed
}

function esc(v: string) {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function itemXml(i: ItemInput) {
  const lines = ["<item>", `  <title>${esc(i.title)}</title>`];
  const permalink = i.guidIsPermalink == null ? "" : ` isPermaLink="${i.guidIsPermalink ? "true" : "false"}"`;
  lines.push(`  <guid${permalink}>${esc(i.guid)}</guid>`);
  if (i.pubDate != null) lines.push(`  <pubDate>${new Date(i.pubDate).toUTCString()}</pubDate>`);
  lines.push("  <!-- enclosure: no audio file yet -->");
  if (i.season != null) lines.push(`  <itunes:season>${i.season}</itunes:season>`);
  if (i.number != null) lines.push(`  <itunes:episode>${i.number}</itunes:episode>`);
  if (i.durationS != null) lines.push(`  <itunes:duration>${i.durationS}</itunes:duration>`);
  lines.push(`  <itunes:explicit>${i.explicit ? "true" : "false"}</itunes:explicit>`);
  for (const p of i.people) {
    const role = p.role ? ` role="${esc(p.role)}"` : "";
    lines.push(`  <podcast:person${role}>${esc(p.name)}</podcast:person>`);
  }
  lines.push("</item>");
  return lines.join("\n");
}

/**
 * Convert a wall-clock "YYYY-MM-DDTHH:mm" in an IANA timezone to UTC ms.
 * Returns null for malformed input or an unknown timezone. Two-pass offset
 * correction handles DST transitions except the nonexistent/ambiguous hour,
 * where it picks one valid instant.
 */
export function zonedToUtcMs(local: string, timeZone: string): number | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(asUtc).getUTCMonth() !== mo - 1) return null; // e.g. Feb 31
  try {
    const offsetAt = (t: number) => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).formatToParts(new Date(t));
      const g = (type: string) => Number(parts.find((p) => p.type === type)!.value);
      return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - t;
    };
    let t = asUtc - offsetAt(asUtc);
    t = asUtc - offsetAt(t);
    return t;
  } catch {
    return null;
  }
}
