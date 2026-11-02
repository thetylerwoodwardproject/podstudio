import { recordingPeaks } from "~/lib/project/peaks.server";

// GET /studio/recordings/:id/peaks — the waveform overview (min/max per 256 samples), auth-gated.
export async function loader({ params }: { params: { id?: string } }) {
  const bytes = await recordingPeaks(params.id ?? "");
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(bytes as BodyInit, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(bytes.length), "Cache-Control": "private, max-age=3600" } });
}
