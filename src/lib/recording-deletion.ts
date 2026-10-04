import { api } from "./api";
import { deleteTake, listTakes, type TakeMeta } from "./audio/takes";
import { clearSourcePeaks } from "./audio/editor-peaks";

const KEY = "podstudio:deleted-recordings";
const deleted = new Set<string>();
export function isRecordingDeleted(id: string) {
  try {
    for (const value of JSON.parse(localStorage.getItem(KEY) ?? "[]"))
      deleted.add(value);
  } catch {}
  return deleted.has(id);
}
export function rememberDeletedRecording(id: string) {
  deleted.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...deleted]));
  } catch {}
  window.dispatchEvent(
    new CustomEvent("podstudio:recording-deleted", { detail: { id } }),
  );
}
export async function cleanupDeletedRecordings(ids: string[]) {
  if (ids.length) {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry("prepared-cache", { recursive: true }).catch((e) => {
      if (e.name !== "NotFoundError") throw e;
    });
  }
  for (const id of ids) {
    rememberDeletedRecording(id);
    await deleteTake(id).catch((e) => {
      if (e.name !== "NotFoundError") throw e;
    });
    localStorage.removeItem(`podstudio-editor-${id}`);
    sessionStorage.removeItem(`podstudio:export:${id}`);
    await clearSourcePeaks([id, `pads-${id}`]);
  }
}
export async function reconcileDeletedRecordings(episodeId: string) {
  const { deleted } = await api<{ deleted: { id: string; group: string }[] }>(
    `recordings/deleted?episode=${encodeURIComponent(episodeId)}`,
  );
  const local = await listTakes(episodeId);
  const ids = [
    ...new Set([
      ...deleted.map((x) => x.id),
      ...local
        .filter((t) =>
          deleted.some((d) => d.id === t.id || d.group === (t.group ?? t.id)),
        )
        .map((t) => t.id),
    ]),
  ];
  await cleanupDeletedRecordings(ids);
  return ids;
}
export async function deleteRecording(
  episodeId: string,
  tracks: TakeMeta[],
  localOnly = false,
) {
  if (!tracks.length || tracks.some((t) => t.status !== "done"))
    throw new Error("End the recording before deleting it.");
  const locks = await navigator.locks?.query();
  if (
    locks?.held?.some((lock) =>
      tracks.some((t) => lock.name === `podstudio-take-${t.id}`),
    )
  )
    throw new Error("Close the active recorder before deleting it.");
  const ids = tracks.map((t) => t.id);
  if (localOnly) {
    // Local-only is permitted only after an authoritative server check.
    const { takes } = await api<{ takes: { id: string; meta: TakeMeta }[] }>(
      `takes?episode=${encodeURIComponent(episodeId)}`,
    );
    if (
      takes.some(
        (t) =>
          ids.includes(t.id) ||
          (t.meta.group ?? t.id) === (tracks[0].group ?? tracks[0].id),
      )
    )
      throw new Error(
        "This recording is on the server. Delete it there as well.",
      );
  }
  const result = await api<{ ids: string[] }>(
    `recordings/${encodeURIComponent(tracks[0].id)}`,
    {
      method: "DELETE",
      body: { episodeId, ids, group: tracks[0].group ?? tracks[0].id },
    },
  );
  await cleanupDeletedRecordings([...new Set([...ids, ...result.ids])]);
}
