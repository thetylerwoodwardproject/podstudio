import { data } from "react-router";
import { artworkFile } from "~/lib/artwork.server";
import { findPublicEpisodeArt } from "~/lib/episode-art.server";
import { imageResponse } from "~/lib/image-assets.server";
import { immutableImage } from "~/lib/image-response";
import { parseImageFile } from "~/lib/image-urls";

// Public: `/{show}/episode-art/{public-id}/{sha}[-s].{ext}` — an episode's own cover,
// only while that episode is published + public. `-s` is the thumbnail.
export async function loader({ params }: { params: { showSlug?: string; publicId?: string; file?: string } }) {
  const f = parseImageFile(params.file);
  const art = findPublicEpisodeArt(params.showSlug ?? "", params.publicId ?? "");
  if (!f || !art || artworkFile(art) !== f.name) throw data("Not found", { status: 404 });
  const r = await imageResponse(art, { thumb: f.thumb, edge: 640 });
  if (!r) throw data("Not found", { status: 404 });
  return immutableImage(r, { contentType: art.contentType, etag: f.thumb ? `${art.sha256}-s` : art.sha256 });
}
