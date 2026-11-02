import { loadProject, saveProject } from "~/lib/project/project.server";

// GET  /studio/projects/:episodeId — the current revision of the edit project.
// POST /studio/projects/:episodeId — { baseRevisionId, document, label? }: append a revision.
// A save based on a stale revision is refused with 409 and the current one, never merged silently.
const noStore = { "Cache-Control": "no-store" };

export async function loader({ params }: { params: { episodeId?: string } }) {
  const p = loadProject(params.episodeId ?? "");
  return p ? Response.json(p, { headers: noStore }) : Response.json({ error: "No project yet." }, { status: 404, headers: noStore });
}

export async function action({ request, params }: { request: Request; params: { episodeId?: string } }) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > 4_000_000) return Response.json({ error: "Too large." }, { status: 413 });
  let body: { baseRevisionId?: unknown; document?: unknown; label?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad JSON." }, { status: 400 });
  }
  if (typeof body.baseRevisionId !== "string") return Response.json({ error: "baseRevisionId is required." }, { status: 400 });
  const label = typeof body.label === "string" ? body.label.slice(0, 80) : null;
  const r = saveProject(params.episodeId ?? "", body.baseRevisionId, body.document, label);
  return Response.json(r, { status: r.ok ? 200 : r.status, headers: noStore });
}
