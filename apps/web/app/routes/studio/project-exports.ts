import { createExport, listExports, setShowDeliveryPreset, showDeliveryPreset } from "~/lib/project/exports.server";

// GET  /studio/projects/:episodeId/exports — recent export jobs for the episode.
// POST /studio/projects/:episodeId/exports { format: "wav", bitDepth, sampleRate, channels } | { format: "mp3", preset } — queue a render
// of the current saved revision. { showDefault: preset } sets the show's default MP3 preset instead.
const noStore = { "Cache-Control": "no-store" };

export async function loader({ params }: { params: { episodeId?: string } }) {
  return Response.json({ exports: listExports(params.episodeId ?? ""), showPreset: showDeliveryPreset() }, { headers: noStore });
}

export async function action({ request, params }: { request: Request; params: { episodeId?: string } }) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await request.json().catch(() => null);
  if (body && typeof body === "object" && "showDefault" in body) {
    const r = setShowDeliveryPreset((body as { showDefault: unknown }).showDefault);
    return Response.json(r, { status: r.ok ? 200 : r.status, headers: noStore });
  }
  const r = createExport(params.episodeId ?? "", body);
  return Response.json(r, { status: r.ok ? 200 : r.status, headers: noStore });
}
