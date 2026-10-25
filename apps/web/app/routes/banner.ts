import { data } from "react-router";
import { artworkFile } from "~/lib/artwork.server";
import { getShowBanner } from "~/lib/banner.server";
import { imageResponse } from "~/lib/image-assets.server";
import { immutableImage } from "~/lib/image-response";
import { parseImageFile } from "~/lib/image-urls";

// Public: `/{show-slug}/banner/{sha}[-s].{ext}` — the show's header image; `-s` is a
// 1920 px wide copy (the original can be several MB). Hash in the name → immutable.
export async function loader({ params }: { params: { showSlug?: string; file?: string } }) {
  const f = parseImageFile(params.file);
  const b = getShowBanner();
  if (!f || !b || b.slug !== params.showSlug || artworkFile(b) !== f.name) throw data("Not found", { status: 404 });
  const r = await imageResponse(b, { thumb: f.thumb, edge: 1920 });
  if (!r) throw data("Not found", { status: 404 });
  return immutableImage(r, { contentType: b.contentType, etag: f.thumb ? `${b.sha256}-s` : b.sha256 });
}
