import type { EmbedConfig } from "~/lib/embeds.server";

// Pure string builder — kept out of the route module so the route only
// exports loader/action/default, and out of embeds.server.ts so the client can use it.
export function buildSnippets(origin: string, slug: string, c: EmbedConfig) {
  const target =
    c.source === "episode" ? (c.episodePublicId ?? "") : c.source === "latest" ? "latest" : "all";
  const params = new URLSearchParams({ player: c.player, theme: c.theme, accent: c.accent });
  if (!c.chapters) params.set("chapters", "0");
  if (!c.transcript) params.set("transcript", "0");
  if (!c.follow) params.set("follow", "0");

  const src = `${origin}/${slug}/embed/${target}?${params.toString()}`;
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
