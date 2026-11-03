import { Readable } from "node:stream";
import { and, desc, eq, inArray } from "drizzle-orm";
import { DEFAULT_DELIVERY_PRESET, isDeliveryPreset, type DeliveryPreset } from "@podstudio/audio/delivery";
import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { db, assets, projectRevisions, projects, renderJobs, shows, storageTargets } from "@podstudio/db";
import { clientFor, routedTarget } from "~/lib/media.server";
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
  if (!p?.currentRevisionId) return { ok: false, error: "This episode has no edit project yet.", status: 404 };
  const rev = db.select({ seq: projectRevisions.seq }).from(projectRevisions).where(eq(projectRevisions.id, p.currentRevisionId)).get();
  if (!rev) return { ok: false, error: "The project's current revision is missing.", status: 500 };
  const id = crypto.randomUUID();
  db.insert(renderJobs).values({ id, episodeId, projectRevisionId: p.currentRevisionId, revisionSeq: rev.seq, kind: format, settings, status: "queued", progress: 0, createdAt: Date.now() }).run();
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

export function listExports(episodeId: string) {
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

