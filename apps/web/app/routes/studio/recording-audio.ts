import { openRecordingAudio } from "~/lib/recordings.server";
import { serveAudio } from "~/lib/project/serve-audio";

// GET /studio/recordings/:id/audio — the finished private WAV for playback in the studio
// (auth-gated by the /studio middleware), with Range support for seeking.
export async function loader({ request, params }: { request: Request; params: { id?: string } }) {
  return serveAudio(request, (range) => openRecordingAudio(params.id ?? "", range));
}
