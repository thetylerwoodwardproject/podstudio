import { robotsTxt } from "~/lib/seo";

export async function loader({ request }: { request: Request }) {
  return new Response(robotsTxt(new URL(request.url).origin), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
