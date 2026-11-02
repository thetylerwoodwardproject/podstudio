import { createImport, listImports } from "~/lib/project/imports.server";

// GET  /studio/projects/:episodeId/imports — recent audio uploads and where each stands.
// PUT  /studio/projects/:episodeId/imports — the raw file as the body (X-Filename, URI-encoded;
//      X-Place: JSON { trackId } or { newTrack }). Kept as-is; the worker decodes it.
const noStore = { "Cache-Control": "no-store" };

export async function loader({ params }: { params: { episodeId?: string } }) {
  return Response.json({ imports: listImports(params.episodeId ?? "") }, { headers: noStore });
}

export async function action({ request, params }: { request: Request; params: { episodeId?: string } }) {
  if (request.method !== "PUT") return new Response("Method not allowed", { status: 405 });
  let filename = "";
  try {
    filename = decodeURIComponent(request.headers.get("x-filename") ?? "");
  } catch {
    // empty name fails the extension check
  }
  let place: { trackId?: string; newTrack?: "host" | "guest" | "music" | "sfx" } = {};
  try {
    const p = JSON.parse(decodeURIComponent(request.headers.get("x-place") ?? "{}"));
    if (typeof p.trackId === "string") place.trackId = p.trackId.slice(0, 100);
    if (["host", "guest", "music", "sfx"].includes(p.newTrack)) place.newTrack = p.newTrack;
  } catch {
    place = {};
  }
  const length = Number(request.headers.get("content-length"));
  const r = await createImport({ episodeId: params.episodeId ?? "", filename, contentLength: Number.isFinite(length) && length > 0 ? length : null, body: request.body, place });
  // Connection: close — a reply sent while the browser is still uploading would leave the keep-alive connection unusable.
  return Response.json(r, { status: r.ok ? 200 : r.status, headers: r.ok ? noStore : { ...noStore, Connection: "close" } });
}
