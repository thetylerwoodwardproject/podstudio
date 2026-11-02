import { openAssetAudio } from "~/lib/project/asset-audio.server";
import { serveAudio } from "~/lib/project/serve-audio";

// GET /studio/assets/:id/audio — a source's private WAV for the editor (Range for seeking).
export async function loader({ request, params }: { request: Request; params: { id?: string } }) {
  return serveAudio(request, (range) => openAssetAudio(params.id ?? "", range));
}
