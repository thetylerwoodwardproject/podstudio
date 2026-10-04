import { api } from "./api";
import { audioFingerprint, type EpisodePackageV1 } from "./episode-package";
import type { EditorProjectV1 } from "./editor-project";
import { WavReader } from "./audio/master";
import { wavHeader } from "./audio/wav";
import { encodeMp3 } from "./audio/mp3";

export async function uploadPrepared(
  path: string,
  data: Blob,
  signal?: AbortSignal,
) {
  const r = await fetch(`/api/prepared-audio/${path}`, {
    method: "PUT",
    body: data,
    signal,
    credentials: "same-origin",
  });
  const result = await r.json();
  if (!r.ok)
    throw new Error(result.error ?? "Upload failed. Retry preparation.");
  return result;
}
/** A PCM slice uses disk-backed File slices, without decoding the whole recording. */
export async function sliceWav(wav: Blob, start: number, end: number) {
  const r = await WavReader.open(wav),
    i = r.info;
  const first = Math.max(0, Math.round(start * i.sampleRate)),
    last = Math.min(r.frames, Math.round(end * i.sampleRate));
  const bpf = (i.channels * i.bitDepth) / 8;
  return new Blob(
    [
      wavHeader(last - first, {
        sampleRate: i.sampleRate,
        channels: i.channels as 1 | 2,
        bitDepth: i.bitDepth as 16 | 24,
      }) as BlobPart,
      wav.slice(i.dataOffset + first * bpf, i.dataOffset + last * bpf),
    ],
    { type: "audio/wav" },
  );
}
export async function prepareEpisodeAudio(
  project: EditorProjectV1,
  revision: number,
  wav: Blob,
  progress: (s: string) => void,
  signal: AbortSignal,
) {
  const fingerprint = await audioFingerprint(project);
  const asset = await api<{ id: string; state: string }>("prepared-audio", {
    body: {
      takeId: project.takeId,
      episodeId: project.episodeId,
      revision,
      fingerprint,
      bytes: wav.size,
    },
  });
  if (asset.state !== "ready") {
    const size = 8 << 20;
    for (let offset = 0, n = 0; offset < wav.size; offset += size, n++) {
      signal.throwIfAborted();
      progress(
        `Uploading finished mix… ${Math.round((offset / wav.size) * 100)}%`,
      );
      await uploadPrepared(
        `${asset.id}/chunks/${n}`,
        wav.slice(offset, offset + size),
        signal,
      );
    }
    progress("Confirming finished mix…");
    await api(`prepared-audio/${asset.id}/complete`, { body: {} });
  }
  signal.throwIfAborted();
  const current = await api<{ revision: number }>(
    `episode-packages/${project.episodeId}`,
  );
  await api(`episode-packages/${project.episodeId}`, {
    body: { baseRevision: current.revision, audioId: asset.id },
  });
}
export async function prepareTranscription(
  audioId: string,
  wav: Blob,
  progress: (s: string) => void,
  signal: AbortSignal,
) {
  const r = await WavReader.open(wav);
  const duration = r.frames / r.info.sampleRate;
  const chunks = [];
  for (let n = 0; n * 600 < duration; n++) {
    signal.throwIfAborted();
    const start = Math.max(0, n * 600 - (n ? 2 : 0)),
      end = Math.min(duration, (n + 1) * 600);
    progress(
      `Compressing transcription audio ${n + 1} of ${Math.ceil(duration / 600)}…`,
    );
    const mp3 = await encodeMp3(
      await sliceWav(wav, start, end),
      "Transcription",
      (d) => progress(`Compressing part ${n + 1}… ${Math.round(d * 100)}%`),
    );
    signal.throwIfAborted();
    progress(`Uploading transcription part ${n + 1}…`);
    await uploadPrepared(`${audioId}/ai/${n}`, mp3, signal);
    chunks.push({ start, end, bytes: mp3.size });
  }
  await api(`prepared-audio/${audioId}/ai-manifest`, {
    method: "PUT",
    body: { chunks },
  });
}
/** Download prepared WAV directly to OPFS; memory stays bounded by network chunks. */
export async function preparedWav(
  audioId: string,
  progress: (s: string) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("prepared-cache", { create: true });
  const handle = await dir.getFileHandle(`server-${audioId}.wav`, {
    create: true,
  });
  const existing = await handle.getFile();
  if (existing.size > 44) return existing;
  const response = await fetch(`/api/prepared-audio/${audioId}/wav`, {
    signal,
  });
  if (!response.ok)
    throw new Error(
      "Prepared mix is unavailable. Open the editor to prepare it again.",
    );
  const writer = await handle.createWritable(),
    reader = response.body!.getReader();
  let bytes = 0;
  const total = Number(response.headers.get("Content-Length"));
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write(value);
      bytes += value.length;
      progress(
        `Loading finished mix… ${total ? Math.round((bytes / total) * 100) : 0}%`,
      );
    }
    await writer.close();
  } catch (e) {
    await writer.abort();
    await dir.removeEntry(`server-${audioId}.wav`);
    throw e;
  }
  return handle.getFile();
}
