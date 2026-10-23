import { data } from "react-router";
import { resolveOembedTarget } from "~/lib/public.server";
import { iframeHtml, parseEmbedOptions } from "~/lib/embed-player";

// `/oembed?url=` — JSON oEmbed (README 27 "Paste a link"): the public episode
// (or show) URL on *this* origin returns a rich embed whose html is the iframe.
// Non-public/unknown/foreign-origin URLs 404, so protected content is never
// described. Only `format=json` (or omitted) is supported.
export async function loader({ request }: { request: Request }) {
  const req = new URL(request.url);
  if ((req.searchParams.get("format") ?? "json") !== "json") throw data("Only JSON is supported", { status: 501 });

  let target: URL;
  try {
    target = new URL(req.searchParams.get("url") ?? "");
  } catch {
    throw data("Missing or invalid url", { status: 400 });
  }
  if (target.origin !== req.origin) throw data("Not found", { status: 404 });

  const m = target.pathname.match(/^\/([^/]+)(?:\/episodes\/([^/]+)(?:\/[^/]*)?)?\/?$/);
  if (!m) throw data("Not found", { status: 404 });
  const resolved = resolveOembedTarget(decodeURIComponent(m[1]), m[2] ? decodeURIComponent(m[2]) : null);
  if (!resolved) throw data("Not found", { status: 404 });

  const opts = parseEmbedOptions(new URLSearchParams());
  const src = `${req.origin}/${resolved.slug}/embed/${encodeURIComponent(resolved.target)}?player=${opts.player}&theme=auto&accent=${opts.accent}`;
  const body = {
    version: "1.0",
    type: "rich",
    provider_name: "Podstudio",
    provider_url: req.origin,
    title: resolved.title,
    width: 600,
    height: 152,
    html: iframeHtml(src, { ...opts, theme: "auto" }),
  };
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
