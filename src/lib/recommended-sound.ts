import { cleanMaster, type EditorProjectV1 } from "./editor-project.ts";

/** An explicit, undoable suggestion. Never modifies the original project. */
export function recommendedSound(project: EditorProjectV1): EditorProjectV1 {
  const next = structuredClone(project);
  for (const track of next.tracks) {
    if (track.kind !== "voice") continue;
    track.fx = {
      noise: 35,
      low: 0,
      mid: 0,
      high: 0,
      compression: "Light",
      level: true,
      macro: { shape: 30, shapePreset: "Clear", boost: 35 },
    };
  }
  const stereo = next.tracks.some(
    (track) => !track.muted && track.channels === 2,
  );
  next.master = cleanMaster({
    ...next.master,
    loudness: stereo ? "stereo" : "mono",
    channels: stereo ? 2 : 1,
    ceilingDb: -1,
  });
  return next;
}
