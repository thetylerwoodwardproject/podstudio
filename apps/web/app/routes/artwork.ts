import { data } from "react-router";
import { Readable } from "node:stream";
import { artworkFile, getShowArtwork, openArtwork } from "~/lib/artwork.server";

// Public: `/{show-slug}/artwork/{sha}.{ext}` — the show's verified artwork, no
// cookies. The hash is in the name, so a stale name is a 404 and a current one is
// safe to cache forever.
export async function loader({ params }: { params: { showSlug?: string; file?: string } }) {
  const art = getShowArtwork();
  if (!art || art.slug !== params.showSlug || artworkFile(art) !== params.file) throw data("Not found", { status: 404 });
  const body = await openArtwork(art);
  if (!body) throw data("Not found", { status: 404 });
  return new Response(Readable.toWeb(body) as ReadableStream, {
    headers: {
      "Content-Type": art.contentType,
      "Content-Length": String(art.bytes ?? ""),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${art.sha256}"`,
    },
  });
}
