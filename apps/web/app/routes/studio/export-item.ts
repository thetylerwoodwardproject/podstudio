import { Readable } from "node:stream";
import { openExport, removeExport } from "~/lib/project/exports.server";

// DELETE /studio/exports/:jobId — cancel an active export, or delete a finished one and its file.
export async function action({ request, params }: { request: Request; params: { jobId?: string } }) {
  if (request.method !== "DELETE") return new Response("Method not allowed", { status: 405 });
  const r = await removeExport(params.jobId ?? "");
  return Response.json(r, { status: r.ok ? 200 : r.status, headers: { "Cache-Control": "no-store" } });
}

// GET /studio/exports/:jobId — download the verified WAV (login required via the /studio middleware).
export async function loader({ params }: { params: { jobId?: string } }) {
  const f = await openExport(params.jobId ?? "");
  if (!f) return new Response("Not found", { status: 404 });
  return new Response(Readable.toWeb(f.body) as ReadableStream, {
    headers: { "Content-Type": "audio/wav", "Content-Length": String(f.bytes), "Content-Disposition": `attachment; filename="${f.filename.replace(/[^\w.\-]/g, "_")}"`, "Cache-Control": "private, no-store" },
  });
}
