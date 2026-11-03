import { data } from "react-router";
import { EmbedPlayer } from "~/components/embed/embed-player";
import { parseEmbedOptions } from "~/lib/embed-player";
import { getEmbedView } from "~/lib/public.server";
import type { Route } from "./+types/embed";

// `/{show-slug}/embed/{public-id|latest|all}` — the iframe document the Embed players screen (27)
// snippets point at: audiocn's AudioPlayer (TrackList for the whole show). Public, no cookies,
// frameable from anywhere (that's its job; server.js skips X-Frame-Options here). Only public +
// published episodes. Scripts and styles are this site's own bundle; nothing from other origins.
export async function loader({ params, request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const view = getEmbedView(params.showSlug ?? "", params.target ?? "", url.origin);
  if (!view) throw data("Not found", { status: 404 });
  return { view, options: parseEmbedOptions(url.searchParams) };
}

/** root.tsx leaves out ScrollRestoration for this page (sandboxed iframes can't touch sessionStorage). */
export const handle = { embed: true };

export function headers() {
  return {
    "Content-Security-Policy":
      "frame-ancestors *; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; media-src 'self'; img-src 'self'",
    "Cache-Control": "public, max-age=60",
  };
}

export function meta({ loaderData: d }: Route.MetaArgs) {
  return [{ title: d?.view.showTitle ?? "Podcast player" }, { name: "robots", content: "noindex" }];
}

export default function Embed({ loaderData }: Route.ComponentProps) {
  return <EmbedPlayer view={loaderData.view} options={loaderData.options} />;
}
