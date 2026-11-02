import { Readable } from "node:stream";
import { parseRange } from "~/lib/http-range";

type Opened = { body: Readable; bytes: number; contentType: string };

/** GET/HEAD with Range support for a private audio object (auth is the /studio middleware's job). */
export async function serveAudio(request: Request, open: (range: { start: number; end: number } | null) => Promise<Opened | null>) {
  const probe = await open({ start: 0, end: 0 });
  if (!probe) return new Response("Not found", { status: 404 });
  probe.body.destroy();
  const size = probe.bytes;
  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  const common = { "Content-Type": probe.contentType, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store" };
  if (request.method === "HEAD") return new Response(null, { headers: { ...common, "Content-Length": String(size) } });
  const part = await open(range);
  if (!part) return new Response("Not found", { status: 404 });
  const body = Readable.toWeb(part.body) as ReadableStream;
  return range
    ? new Response(body, { status: 206, headers: { ...common, "Content-Length": String(range.end - range.start + 1), "Content-Range": `bytes ${range.start}-${range.end}/${size}` } })
    : new Response(body, { headers: { ...common, "Content-Length": String(size) } });
}
