import { startProject } from "~/lib/project/project.server";

// POST /studio/projects/:episodeId/start { recordingId, timeZone? } — create the edit project from a finished recording.
export async function action({ request, params }: { request: Request; params: { episodeId?: string } }) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = (await request.json().catch(() => ({}))) as { recordingId?: unknown; timeZone?: unknown };
  if (typeof body.recordingId !== "string") return Response.json({ error: "recordingId is required." }, { status: 400 });
  const r = startProject(params.episodeId ?? "", body.recordingId, typeof body.timeZone === "string" ? body.timeZone : undefined);
  return Response.json(r, { status: r.ok ? 200 : r.status, headers: { "Cache-Control": "no-store" } });
}
