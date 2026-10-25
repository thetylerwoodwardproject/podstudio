import { data } from "react-router";
import { getSitemapEntries } from "~/lib/public.server";
import { sitemapXml } from "~/lib/seo";

// `/sitemap.xml` — the show page, every public published episode and every public
// profile. Nothing private: it uses the same public-only queries as the pages.
export async function loader({ request }: { request: Request }) {
  const entries = getSitemapEntries(new URL(request.url).origin);
  if (!entries) throw data("Not found", { status: 404 });
  return new Response(sitemapXml(entries), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=900" },
  });
}
