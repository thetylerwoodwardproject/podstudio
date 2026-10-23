// Pure builder for the <podcast:podroll> block, shared by the Podroll screen's
// live preview (32) and, later, the feed generator. Per README: every
// <podcast:remoteItem> must carry `feedGuid`; also write `title` (and
// `feedUrl` when known). Podroll order = feed order = page order.
export interface PodrollEntry {
  feedGuid: string;
  feedUrl: string | null;
  title: string;
}

function esc(v: string) {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function podrollXml(items: PodrollEntry[]) {
  if (items.length === 0) return "";
  const lines = items.map(
    (i) =>
      `  <podcast:remoteItem feedGuid="${esc(i.feedGuid)}"` +
      (i.feedUrl ? ` feedUrl="${esc(i.feedUrl)}"` : "") +
      ` title="${esc(i.title)}"/>`,
  );
  return `<podcast:podroll>\n${lines.join("\n")}\n</podcast:podroll>`;
}
