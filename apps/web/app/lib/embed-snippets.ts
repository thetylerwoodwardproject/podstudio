import type { EmbedConfig } from "~/lib/embeds.server";

// Pure string builder — kept out of the route module so the route only
// exports loader/action/default, and out of embeds.server.ts so the client can use it.
export function embedTarget(c: EmbedConfig) {
  return c.source === "episode" ? (c.episodePublicId ?? "") : c.source === "latest" ? "latest" : "all";
}

/** The real `/{show}/embed/*` URL for a config — what the iframe snippet and the live preview load. */
export function embedSrc(origin: string, slug: string, c: EmbedConfig) {
  const params = new URLSearchParams({ player: c.player, theme: c.theme, accent: c.accent });
  if (!c.chapters) params.set("chapters", "0");
  if (!c.transcript) params.set("transcript", "0");
  if (!c.follow) params.set("follow", "0");
  return `${origin}/${slug}/embed/${embedTarget(c)}?${params.toString()}`;
}

export function buildSnippets(origin: string, slug: string, c: EmbedConfig) {
  const target = embedTarget(c);
  const src = embedSrc(origin, slug, c);
  const height = c.player === "video" ? 360 : 152;
  const iframe =
    `<iframe src="${src.replace(/&/g, "&amp;")}"\n` +
    `  width="100%" height="${height}" style="border:0" loading="lazy"\n` +
    `  title="Podcast player" allow="autoplay"></iframe>`;

  const attrs = [
    `data-podstudio="${slug}/${target}"`,
    `data-player="${c.player}"`,
    `data-theme="${c.theme}"`,
    `data-accent="${c.accent}"`,
    ...(c.chapters ? [] : [`data-chapters="0"`]),
    ...(c.transcript ? [] : [`data-transcript="0"`]),
    ...(c.follow ? [] : [`data-follow="0"`]),
  ];
  const script = `<div ${attrs.join(" ")}></div>\n<script src="${origin}/embed.js" async></script>`;

  const link =
    c.source === "episode" ? `${origin}/${slug}/episodes/${c.episodePublicId ?? ""}` : `${origin}/${slug}`;

  return { iframe, script, link };
}
