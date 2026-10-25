import { data } from "react-router";
import { Readable } from "node:stream";
import { avatarFile, findPublicAvatar, openAvatar } from "~/lib/people.server";

// Public: `/{show-slug}/avatar/{person-id}/{sha}.{ext}` — a host's or guest's
// verified headshot, only for people who may appear publicly (hosts, and guests on
// a public episode). The hash is in the name, so a stale name is a 404 and a
// current one is safe to cache forever.
export async function loader({ params }: { params: { showSlug?: string; personId?: string; file?: string } }) {
  const a = findPublicAvatar(params.showSlug ?? "", params.personId ?? "");
  if (!a || avatarFile(a) !== params.file) throw data("Not found", { status: 404 });
  const body = await openAvatar(a);
  if (!body) throw data("Not found", { status: 404 });
  return new Response(Readable.toWeb(body) as ReadableStream, {
    headers: {
      "Content-Type": a.contentType,
      "Content-Length": String(a.bytes ?? ""),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${a.sha256}"`,
    },
  });
}
