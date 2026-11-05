import { artAsset, removeEpisodeArtwork, uploadEpisodeArtwork } from "~/lib/episode-art.server";
import { imageResponse } from "~/lib/image-assets.server";
import { immutableImage } from "~/lib/image-response";

// GET = the cover for the studio's own preview (works for private drafts; the public route does not).
export async function loader({ params }: { params: { id?: string } }) {
  const art = artAsset(params.id ?? "");
  const r = art && (await imageResponse(art, { thumb: true, edge: 640 }));
  if (!art || !r) return new Response("Not found", { status: 404 });
  const res = immutableImage(r, { contentType: art.contentType, etag: art.sha256 ? `${art.sha256}-s` : null });
  res.headers.set("Cache-Control", "private, max-age=3600"); // signed-in preview, not for shared caches
  return res;
}

// Resource route under /studio (auth middleware applies). PUT = raw image body; DELETE = remove.
export async function action({ request, params }: { request: Request; params: { id?: string } }) {
  const id = params.id ?? "";
  if (request.method === "PUT") {
    const len = request.headers.get("content-length");
    const r = await uploadEpisodeArtwork(id, request.body, len ? Number(len) : null);
    if (r.ok) return Response.json({ ok: true });
    return Response.json({ ok: false, error: r.error }, { status: r.status, headers: { Connection: "close" } });
  }
  if (request.method === "DELETE") {
    await removeEpisodeArtwork(id);
    return Response.json({ ok: true });
  }
  return new Response("Method not allowed", { status: 405 });
}
