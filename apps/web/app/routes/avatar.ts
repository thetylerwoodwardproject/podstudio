import { data } from "react-router";
import { avatarFile, findPublicAvatar } from "~/lib/people.server";
import { imageResponse } from "~/lib/image-assets.server";
import { immutableImage } from "~/lib/image-response";
import { parseImageFile } from "~/lib/image-urls";

// Public: `/{show-slug}/avatar/{person-id}/{sha}[-s].{ext}` — a host's or guest's
// verified headshot (`-s` = 256 px thumbnail), only for people who may appear
// publicly (hosts, and guests on a public episode). The hash is in the name, so a
// stale name is a 404 and a current one is safe to cache forever.
export async function loader({ params }: { params: { showSlug?: string; personId?: string; file?: string } }) {
  const f = parseImageFile(params.file);
  const a = findPublicAvatar(params.showSlug ?? "", params.personId ?? "");
  if (!f || !a || avatarFile(a) !== f.name) throw data("Not found", { status: 404 });
  const r = await imageResponse({ ...a, bytes: a.bytes }, { thumb: f.thumb, edge: 256 });
  if (!r) throw data("Not found", { status: 404 });
  return immutableImage(r, { contentType: a.contentType, etag: f.thumb ? `${a.sha256}-s` : a.sha256 });
}
