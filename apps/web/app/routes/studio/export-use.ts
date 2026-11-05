import { useExportAsEpisodeAudio } from "~/lib/project/exports.server";

// POST /studio/exports/:jobId/use — make this finished MP3 export the episode's feed audio (no download and re-upload).
export async function action({ request, params }: { request: Request; params: { jobId?: string } }) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const r = await useExportAsEpisodeAudio(params.jobId ?? "");
  return Response.json(r, { status: r.ok ? 200 : r.status, headers: { "Cache-Control": "no-store" } });
}
