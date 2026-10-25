import { setAnnotations } from "~/lib/recordings.server";

// PUT /studio/recordings/:id/annotations — the current retake list (replaces it).
export async function action({ request, params }: { request: Request; params: { id?: string } }) {
  if (request.method !== "PUT") return new Response("Method not allowed", { status: 405 });
  const body = (await request.json().catch(() => null)) as { annotations?: unknown } | null;
  const r = setAnnotations(params.id ?? "", body?.annotations);
  return r.ok ? Response.json({ ok: true }) : Response.json({ ok: false, error: r.error }, { status: r.status });
}
