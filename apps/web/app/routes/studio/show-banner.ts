import { removeShowBanner, uploadShowBanner } from "~/lib/banner.server";

// Resource route under /studio (auth middleware applies). PUT = raw image body; DELETE = remove.
export async function action({ request }: { request: Request }) {
  if (request.method === "PUT") {
    const len = request.headers.get("content-length");
    const r = await uploadShowBanner(request.body, len ? Number(len) : null);
    if (r.ok) return Response.json({ ok: true });
    return Response.json({ ok: false, error: r.error }, { status: r.status, headers: { Connection: "close" } });
  }
  if (request.method === "DELETE") {
    await removeShowBanner();
    return Response.json({ ok: true });
  }
  return new Response("Method not allowed", { status: 405 });
}
