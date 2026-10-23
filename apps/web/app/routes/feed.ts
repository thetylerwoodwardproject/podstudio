import { data } from "react-router";
import { getFeedXml } from "~/lib/feed-data.server";

// Resource route: `/{show-slug}/feed` — the show's RSS feed, public, no
// cookies. Channel-level metadata is real (show tags, lock, TXT records,
// funding, podroll, hosts); it has no <item>s yet because items need an
// uploaded audio enclosure (Stage 02) — see lib/feed-xml.ts.
export async function loader({ params, request }: { params: { showSlug?: string }; request: Request }) {
  const origin = new URL(request.url).origin;
  const xml = getFeedXml(params.showSlug ?? "", origin);
  if (xml == null) throw data("Not found", { status: 404 });
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
