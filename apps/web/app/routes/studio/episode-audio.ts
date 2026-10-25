import { uploadEpisodeAudio, removeEpisodeAudio } from "~/lib/media.server";

// Resource route (no UI). Lives under routes/studio/ so the login middleware
// covers it. The file is the raw request body, not multipart, so it can be
// streamed to storage without ever holding the whole MP3 in memory; the
// filename arrives URI-encoded in `X-Filename`.
export async function action({ request, params }: { request: Request; params: { id: string } }) {
  if (request.method === "PUT") {
    let filename = "";
    try {
      filename = decodeURIComponent(request.headers.get("x-filename") ?? "");
    } catch {
      /* falls through to the .mp3 check */
    }
    const length = Number(request.headers.get("content-length"));
    const result = await uploadEpisodeAudio({
      episodeId: params.id,
      filename,
      contentType: request.headers.get("content-type") ?? "",
      contentLength: Number.isFinite(length) && length > 0 ? length : null,
      body: request.body,
    });
    if (!result.ok) {
      // Connection: close because a reply sent while the browser is still uploading
      // leaves the keep-alive connection to Caddy unusable (the next request got a 502).
      return Response.json({ error: result.error }, { status: result.status, headers: { Connection: "close" } });
    }
    return Response.json({ ok: true, assetId: result.assetId });
  }
  if (request.method === "DELETE") {
    await removeEpisodeAudio(params.id);
    return Response.json({ ok: true });
  }
  return Response.json({ error: "Method not allowed." }, { status: 405 });
}

