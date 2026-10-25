import { data } from "react-router";
import { artworkFile, getShowArtwork } from "~/lib/artwork.server";
import { imageResponse } from "~/lib/image-assets.server";
import { immutableImage } from "~/lib/image-response";
import { parseImageFile } from "~/lib/image-urls";

// Public: `/{show-slug}/artwork/{sha}[-s].{ext}` — the show's verified artwork, no
// cookies; `-s` is a 640 px thumbnail. The hash is in the name, so a stale name is a
// 404 and a current one is safe to cache forever.
export async function loader({ params }: { params: { showSlug?: string; file?: string } }) {
  const f = parseImageFile(params.file);
  const art = getShowArtwork();
  if (!f || !art || art.slug !== params.showSlug || artworkFile(art) !== f.name) throw data("Not found", { status: 404 });
  const r = await imageResponse(art, { thumb: f.thumb, edge: 640 });
  if (!r) throw data("Not found", { status: 404 });
  return immutableImage(r, { contentType: art.contentType, etag: f.thumb ? `${art.sha256}-s` : art.sha256 });
}
