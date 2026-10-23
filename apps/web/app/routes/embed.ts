import { data } from "react-router";
import { getEmbedView } from "~/lib/public.server";
import { embedHtml, parseEmbedOptions } from "~/lib/embed-player";

// Resource route: `/{show-slug}/embed/{public-id|latest|all}` — the iframe
// document the Embed players screen (27) snippets point at. Public, no cookies,
// frameable from anywhere (that's its job). Only public + published episodes.
export async function loader({ params, request }: { params: { showSlug?: string; target?: string }; request: Request }) {
  const url = new URL(request.url);
  const view = getEmbedView(params.showSlug ?? "", params.target ?? "", url.origin);
  if (!view) throw data("Not found", { status: 404 });
  return new Response(embedHtml(view, parseEmbedOptions(url.searchParams)), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "frame-ancestors *; default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
      "Cache-Control": "public, max-age=60",
    },
  });
}
