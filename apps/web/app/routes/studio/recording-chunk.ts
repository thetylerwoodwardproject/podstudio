import { putChunk } from "~/lib/recordings.server";

// PUT /studio/recordings/:id/chunks/:seq — raw PCM bytes. Headers carry the chunk's
// position on the capture clock and its SHA-256; the server re-hashes what it got.
export async function action({ request, params }: { request: Request; params: { id?: string; seq?: string } }) {
  if (request.method !== "PUT") return new Response("Method not allowed", { status: 405 });
  const h = request.headers;
  const r = await putChunk(
    params.id ?? "",
    Number(params.seq),
    { firstSample: Number(h.get("x-first-sample")), sampleCount: Number(h.get("x-sample-count")), sha256: (h.get("x-chunk-sha256") ?? "").toLowerCase() },
    request.body,
  );
  return r.ok ? Response.json({ ok: true, duplicate: r.duplicate }) : Response.json({ ok: false, error: r.error }, { status: r.status, headers: { Connection: "close" } });
}
