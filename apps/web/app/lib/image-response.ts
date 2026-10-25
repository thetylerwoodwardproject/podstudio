import { Readable } from "node:stream";

/** Wraps what imageResponse() returns (a stream, or a buffer for a just-made thumbnail) in a cacheable Response. */
export function immutableImage(
  r: { body: Readable | Buffer; length?: number },
  headers: { contentType: string; etag: string | null },
) {
  const body = Buffer.isBuffer(r.body) ? new Uint8Array(r.body) : (Readable.toWeb(r.body) as ReadableStream);
  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": headers.contentType,
      ...(r.length != null ? { "Content-Length": String(r.length) } : {}),
      "Cache-Control": "public, max-age=31536000, immutable",
      ...(headers.etag ? { ETag: `"${headers.etag}"` } : {}),
    },
  });
}
