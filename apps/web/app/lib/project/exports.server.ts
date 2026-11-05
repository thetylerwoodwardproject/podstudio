import { Readable } from "node:stream";
import { and, desc, eq, inArray } from "drizzle-orm";
import { DEFAULT_DELIVERY_PRESET, isDeliveryPreset, type DeliveryPreset } from "@podstudio/audio/delivery";
import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { db, assets, episodes, projectRevisions, projects, renderJobs, shows, storageTargets } from "@podstudio/db";
import { clientFor, routedTarget, uploadEpisodeAudio } from "~/lib/media.server";
import { deleteAssetAndObject } from "~/lib/project/imports.server";
import { loadProject } from "~/lib/project/project.server";

// Server-only. Export jobs are rows the worker renders (see apps/worker/src/render-jobs.ts);
// the web side only creates, lists, cancels, deletes and streams the finished file.

export type ExportSettings = { bitDepth: 16 | 24; sampleRate: 44100 | 48000; channels: 1 | 2 };
type Fail = { ok: false; error: string; status: number };

export function createExport(episodeId: string, raw: unknown): { ok: true; id: string } | Fail {
  const r = (raw ?? {}) as Record<string, unknown>;
  const format = r.format === "mp3" ? "mp3" : "wav";
  let settings: Record<string, unknown>;
  if (format === "mp3") {
    if (!isDeliveryPreset(r.preset)) return { ok: false, error: "Pick an MP3 preset.", status: 422 };
    settings = { preset: r.preset };
  } else {
    if (r.bitDepth !== 16 && r.bitDepth !== 24) return { ok: false, error: "Bit depth must be 16 or 24.", status: 422 };
    if (r.sampleRate !== 44100 && r.sampleRate !== 48000) return { ok: false, error: "Sample rate must be 44.1 or 48 kHz.", status: 422 };
    const channels = r.channels === undefined ? 1 : r.channels;
    if (channels !== 1 && channels !== 2) return { ok: false, error: "Channels must be 1 (mono) or 2 (stereo).", status: 422 };
    settings = { bitDepth: r.bitDepth, sampleRate: r.sampleRate, channels };
  }
  if (!routedTarget("exports")) return { ok: false, error: "No storage target is routed for exports. Set one up in Storage.", status: 409 };
  const p = db.select().from(projects).where(eq(projects.episodeId, episodeId)).get();
  let revisionId = p?.currentRevisionId ?? null;
  // "Convert to MP3": render the exact edit an earlier export came from, not whatever the project is now
  const from = typeof r.fromJobId === "string" ? db.select().from(renderJobs).where(and(eq(renderJobs.id, r.fromJobId), eq(renderJobs.episodeId, episodeId))).get() : null;
  if (r.fromJobId !== undefined && (!from || from.status !== "verified" || !from.projectRevisionId)) return { ok: false, error: "That export isn't available to convert.", status: 409 };
  if (from) revisionId = from.projectRevisionId;
  if (!revisionId) return { ok: false, error: "This episode has no edit project yet.", status: 404 };
  const rev = db.select({ seq: projectRevisions.seq }).from(projectRevisions).where(eq(projectRevisions.id, revisionId)).get();
  if (!rev) return { ok: false, error: "That revision of the project is missing.", status: 500 };
  const id = crypto.randomUUID();
  db.insert(renderJobs).values({ id, episodeId, projectRevisionId: revisionId, revisionSeq: rev.seq, kind: format, settings, status: "queued", progress: 0, createdAt: Date.now() }).run();
  return { ok: true, id };
}

/** The show's default delivery preset (shows.settings.delivery.preset), falling back to 128 kbps stereo. */
export function showDeliveryPreset(): DeliveryPreset {
  const show = db.select({ settings: shows.settings }).from(shows).get();
  const p = (show?.settings as { delivery?: { preset?: unknown } } | null)?.delivery?.preset;
  return isDeliveryPreset(p) ? p : DEFAULT_DELIVERY_PRESET;
}

export function setShowDeliveryPreset(preset: unknown): { ok: true } | Fail {
  if (!isDeliveryPreset(preset)) return { ok: false, error: "Unknown preset.", status: 422 };
  const show = db.select({ id: shows.id, settings: shows.settings }).from(shows).get();
  if (!show) return { ok: false, error: "No show.", status: 404 };
  const settings = { ...((show.settings as Record<string, unknown> | null) ?? {}), delivery: { preset } };
  db.update(shows).set({ settings }).where(eq(shows.id, show.id)).run();
  return { ok: true };
}

/** The episode's current feed audio, by checksum — to tell which export (if any) is already in use. */
function episodeAudioSha(episodeId: string): string | null {
  const ep = db.select({ a: episodes.audioAssetId }).from(episodes).where(eq(episodes.id, episodeId)).get();
  return ep?.a ? (db.select({ sha: assets.sha256 }).from(assets).where(eq(assets.id, ep.a)).get()?.sha ?? null) : null;
}

export function listExports(episodeId: string) {
  const inUseSha = episodeAudioSha(episodeId);
  return listExportRows(episodeId).map((j) => {
    const sha = j.kind === "mp3" && j.status === "verified" ? (db.select({ sha: assets.sha256 }).from(renderJobs).innerJoin(assets, eq(assets.id, renderJobs.assetId)).where(eq(renderJobs.id, j.id)).get()?.sha ?? null) : null;
    return { ...j, inUse: !!sha && sha === inUseSha };
  });
}

/** The newest verified MP3 export, for the Publish screen's "use it" shortcut. */
export function latestMp3Export(episodeId: string) {
  const j = listExportRows(episodeId).find((x) => x.kind === "mp3" && x.status === "verified");
  return j ? { id: j.id, finishedAt: j.finishedAt, preset: (j.settings as { preset?: string } | null)?.preset ?? null, inUse: listExports(episodeId).find((x) => x.id === j.id)?.inUse ?? false } : null;
}

/** Make a finished MP3 export the episode's feed audio: same checks as an upload (it is read back and verified), replaces the previous file. */
export async function useExportAsEpisodeAudio(jobId: string): Promise<{ ok: true } | Fail> {
  const job = db.select().from(renderJobs).where(eq(renderJobs.id, jobId)).get();
  if (!job || job.kind !== "mp3" || job.status !== "verified") return { ok: false, error: "Only a finished MP3 export can be used as the episode's audio.", status: 409 };
  const f = await openExport(jobId);
  if (!f) return { ok: false, error: "That export's file is missing.", status: 404 };
  const r = await uploadEpisodeAudio({ episodeId: job.episodeId, filename: /\.mp3$/i.test(f.filename) ? f.filename : `${f.filename}.mp3`, contentType: "audio/mpeg", contentLength: f.bytes || null, body: Readable.toWeb(f.body) as ReadableStream<Uint8Array> });
  return r.ok ? { ok: true } : { ok: false, error: r.error, status: r.status };
}

function listExportRows(episodeId: string) {
  return db
    .select({ id: renderJobs.id, kind: renderJobs.kind, status: renderJobs.status, progress: renderJobs.progress, revisionSeq: renderJobs.revisionSeq, settings: renderJobs.settings, summary: renderJobs.summary, error: renderJobs.error, createdAt: renderJobs.createdAt, finishedAt: renderJobs.finishedAt, cancelRequested: renderJobs.cancelRequested })
    .from(renderJobs)
    .where(and(eq(renderJobs.episodeId, episodeId), inArray(renderJobs.kind, ["wav", "mp3"])))
    .orderBy(desc(renderJobs.createdAt))
    .limit(20)
    .all();
}

/** Active jobs get a cancel request (the worker stops at the next block); finished ones are removed with their file. */
export async function removeExport(jobId: string): Promise<{ ok: true; action: "cancelling" | "cancelled" | "deleted" } | Fail> {
  const job = db.select().from(renderJobs).where(eq(renderJobs.id, jobId)).get();
  if (!job) return { ok: false, error: "Not found.", status: 404 };
  if (job.status === "queued") {
    db.update(renderJobs).set({ status: "cancelled", finishedAt: Date.now() }).where(and(eq(renderJobs.id, jobId), eq(renderJobs.status, "queued"))).run();
    return { ok: true, action: "cancelled" };
  }
  if (job.status === "running") {
    db.update(renderJobs).set({ cancelRequested: 1 }).where(eq(renderJobs.id, jobId)).run();
    return { ok: true, action: "cancelling" };
  }
  if (job.kind === "import" && job.assetId && loadProject(job.episodeId)?.doc.sources.some((x) => x.assetId === job.assetId)) return { ok: false, error: "That audio is used by the project. Remove its clips first.", status: 409 };
  const original = (job.settings as { originalAssetId?: string } | null)?.originalAssetId;
  const assetId = job.assetId;
  db.update(renderJobs).set({ assetId: null }).where(eq(renderJobs.id, jobId)).run();
  await deleteAssetAndObject(assetId);
  await deleteAssetAndObject(original);
  db.delete(renderJobs).where(eq(renderJobs.id, jobId)).run();
  return { ok: true, action: "deleted" };
}

/** Every job of the episode (exports and imports), with their files. */
export async function deleteExportsForEpisode(episodeId: string) {
  const ids = db.select({ id: renderJobs.id, status: renderJobs.status }).from(renderJobs).where(eq(renderJobs.episodeId, episodeId)).all();
  for (const j of ids) {
    if (j.status === "queued" || j.status === "running") db.update(renderJobs).set({ status: "cancelled", finishedAt: Date.now() }).where(eq(renderJobs.id, j.id)).run();
    await removeExport(j.id);
  }
}

export async function openExport(jobId: string) {
  const job = db.select().from(renderJobs).where(and(eq(renderJobs.id, jobId), eq(renderJobs.status, "verified"))).get();
  const a = job?.assetId ? db.select().from(assets).where(and(eq(assets.id, job.assetId), eq(assets.status, "verified"))).get() : null;
  const t = a && db.select().from(storageTargets).where(eq(storageTargets.id, a.storageTargetId)).get();
  if (!a || !t) return null;
  const c = clientFor(t);
  try {
    const obj = await c.send(new GetObjectCommand({ Bucket: t.bucket, Key: a.key }));
    const body = obj.Body as Readable;
    body.on("close", () => c.destroy());
    return { body, bytes: a.bytes ?? 0, filename: a.filename ?? "export.wav", contentType: a.contentType ?? "audio/wav" };
  } catch (e) {
    c.destroy();
    throw e;
  }
}

