import { deleteRecording, getRecordingStatus } from "~/lib/recordings.server";

// GET /studio/recordings/:id — server-side truth about what has been verified (the
// client reconciles its journal against this after a reload). DELETE removes it.
export async function loader({ params }: { params: { id?: string } }) {
  const s = getRecordingStatus(params.id ?? "");
  return s ? Response.json(s, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function action({ request, params }: { request: Request; params: { id?: string } }) {
  if (request.method !== "DELETE") return new Response("Method not allowed", { status: 405 });
  await deleteRecording(params.id ?? "");
  return Response.json({ ok: true });
}
