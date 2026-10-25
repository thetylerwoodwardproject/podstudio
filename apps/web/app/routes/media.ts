import { Readable } from "node:stream";
import { findPublicAudio, openAudio } from "~/lib/media.server";
import { parseRange } from "~/lib/http-range";

// `/{show}/media/{public-id}/{anything}.mp3` — the feed <enclosure> target and
// the public player's source. Public, no cookies. HEAD is routed here by React
// Router with the body dropped.
export async function loader({ params, request }: { params: { showSlug?: string; publicId?: string }; request: Request }) {
  const audio = findPublicAudio(params.showSlug ?? "", params.publicId ?? "");
  if (!audio || audio.bytes == null) return new Response("Not found", { status: 404 });

  const size = audio.bytes;
  const range = parseRange(request.headers.get("range"), size);
  const headers = new Headers({
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    ETag: `"${audio.sha256}"`,
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  });
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  if (request.method === "HEAD") {
    headers.set("Content-Length", String(range ? range.end - range.start + 1 : size));
    return new Response(null, { status: range ? 206 : 200, headers });
  }

  const body = await openAudio(audio, range);
  if (!body) return new Response("Not found", { status: 404 });
  const web = Readable.toWeb(body) as ReadableStream<Uint8Array>;
  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    return new Response(web, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(web, { status: 200, headers });
}
