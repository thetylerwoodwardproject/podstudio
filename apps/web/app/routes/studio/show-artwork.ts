import { removeShowArtwork, uploadShowArtwork } from "~/lib/artwork.server";

// Resource route under /studio, so the studio auth middleware gates it.
// PUT = raw image body (replaces any current artwork); DELETE = remove it.
export async function action({ request }: { request: Request }) {
  if (request.method === "PUT") {
    const len = request.headers.get("content-length");
    const r = await uploadShowArtwork(request.body, len ? Number(len) : null);
    if (r.ok) return Response.json({ ok: true });
    return Response.json({ ok: false, error: r.error }, { status: r.status, headers: { Connection: "close" } });
  }
  if (request.method === "DELETE") {
    await removeShowArtwork();
    return Response.json({ ok: true });
  }
  return new Response("Method not allowed", { status: 405 });
}
