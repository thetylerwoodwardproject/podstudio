import { assetPeaks } from "~/lib/project/peaks.server";

// GET /studio/assets/:id/peaks — waveform overview for a source.
export async function loader({ params }: { params: { id?: string } }) {
  const bytes = await assetPeaks(params.id ?? "");
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(bytes as BodyInit, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(bytes.length), "Cache-Control": "private, max-age=3600" } });
}
