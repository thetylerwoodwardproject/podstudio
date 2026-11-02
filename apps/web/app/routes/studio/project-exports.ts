import { createExport, listExports } from "~/lib/project/exports.server";

// GET  /studio/projects/:episodeId/exports — recent export jobs for the episode.
// POST /studio/projects/:episodeId/exports { bitDepth, sampleRate } — queue a WAV render of the current saved revision.
const noStore = { "Cache-Control": "no-store" };

export async function loader({ params }: { params: { episodeId?: string } }) {
  return Response.json({ exports: listExports(params.episodeId ?? "") }, { headers: noStore });
}

export async function action({ request, params }: { request: Request; params: { episodeId?: string } }) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await request.json().catch(() => null);
  const r = createExport(params.episodeId ?? "", body);
  return Response.json(r, { status: r.ok ? 200 : r.status, headers: noStore });
}
