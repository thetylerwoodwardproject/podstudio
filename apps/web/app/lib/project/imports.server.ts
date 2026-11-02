import { createHash } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import { and, desc, eq } from "drizzle-orm";
import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { db, assets, episodes, projectRevisions, projects, renderJobs, storageTargets } from "@podstudio/db";
import { clientFor, routedTarget } from "~/lib/media.server";

// Server-only. Uploading existing audio onto a track: the original file is kept as-is in the
// private raw bucket (kind "import_original"); the worker then decodes it with ffmpeg to the
// project format (48 kHz, mono, 24-bit WAV, kind "raw_audio") and verifies it. Only that
// decoded asset can become a source in the project.

export const IMPORT_EXTENSIONS = ["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "aif", "aiff", "wma", "mp4", "mov", "webm"] as const;
export const IMPORT_MAX_BYTES = 1024 * 1024 * 1024;
type Fail = { ok: false; error: string; status: number };
export type PlaceHint = { trackId?: string; newTrack?: "host" | "guest" | "music" | "sfx" };

class Rejected extends Error {}

export type StoredOriginal = { assetId: string; filename: string };

/** Stream an uploaded file into the private raw bucket as-is, verify it, and record it as an `import_original` asset. */
export async function storeOriginal(input: { showId: string; episodeId: string | null; filename: string; contentLength: number | null; body: ReadableStream<Uint8Array> | null; keyPrefix: string }): Promise<({ ok: true } & StoredOriginal) | Fail> {
  const name = input.filename.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 200);
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (!(IMPORT_EXTENSIONS as readonly string[]).includes(ext)) return { ok: false, error: `Unsupported file type ".${ext}". Use WAV, MP3, M4A, AAC, FLAC, OGG/Opus or AIFF.`, status: 415 };
  if (input.contentLength !== null && input.contentLength > IMPORT_MAX_BYTES) return { ok: false, error: "That file is over 1 GB.", status: 413 };
  if (!input.body) return { ok: false, error: "No file received.", status: 400 };
  const target = routedTarget("raw");
  if (!target) return { ok: false, error: "No storage target is routed for raw audio. Set one up in Storage.", status: 409 };
  const assetId = crypto.randomUUID();
  const key = `${input.keyPrefix}/original.${ext}`;
  const client = clientFor(target);
  const hash = createHash("sha256");
  let received = 0;
  const tap = new PassThrough();
  tap.on("data", (b: Buffer) => {
    received += b.length;
    hash.update(b);
    if (received > IMPORT_MAX_BYTES) tap.destroy(new Rejected("That file is over 1 GB."));
  });
  try {
    const src = Readable.fromWeb(input.body as import("node:stream/web").ReadableStream<Uint8Array>);
    src.on("error", (e) => tap.destroy(e));
    await new Upload({ client, params: { Bucket: target.bucket, Key: key, Body: src.pipe(tap), ContentType: "application/octet-stream" }, queueSize: 3, partSize: 8 * 1024 * 1024, leavePartsOnError: false }).done();
    if (received === 0) throw new Rejected("The file is empty.");
    const head = await client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: key }));
    if (head.ContentLength !== received) throw new Error(`Stored ${head.ContentLength} bytes but received ${received}.`);
    const now = Date.now();
    db.insert(assets).values({ id: assetId, showId: input.showId, episodeId: input.episodeId, kind: "import_original", access: "private", storageTargetId: target.id, key, filename: name, contentType: "application/octet-stream", bytes: received, sha256: hash.digest("hex"), status: "verified", meta: { originalName: name }, createdAt: now, verifiedAt: now }).run();
    return { ok: true, assetId, filename: name };
  } catch (e) {
    await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: key })).catch(() => {});
    if (e instanceof Rejected) return { ok: false, error: e.message, status: 413 };
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed.", status: 500 };
  } finally {
    client.destroy();
  }
}

export async function createImport(input: { episodeId: string; filename: string; contentLength: number | null; body: ReadableStream<Uint8Array> | null; place: PlaceHint }): Promise<{ ok: true; jobId: string } | Fail> {
  const { episodeId } = input;
  const ep = db.select({ showId: episodes.showId }).from(episodes).where(eq(episodes.id, episodeId)).get();
  const proj = db.select().from(projects).where(eq(projects.episodeId, episodeId)).get();
  if (!ep || !proj?.currentRevisionId) return { ok: false, error: "This episode has no edit project yet.", status: 404 };
  const rev = db.select({ seq: projectRevisions.seq }).from(projectRevisions).where(eq(projectRevisions.id, proj.currentRevisionId)).get();
  if (!rev) return { ok: false, error: "No project revision.", status: 500 };
  const jobId = crypto.randomUUID();
  const stored = await storeOriginal({ showId: ep.showId, episodeId, filename: input.filename, contentLength: input.contentLength, body: input.body, keyPrefix: `imports/${episodeId}/${jobId}` });
  if (!stored.ok) return stored;
  db.insert(renderJobs).values({ id: jobId, episodeId, projectRevisionId: proj.currentRevisionId, revisionSeq: rev.seq, kind: "import", settings: { originalAssetId: stored.assetId, filename: stored.filename, place: input.place }, status: "queued", progress: 0, createdAt: Date.now() }).run();
  return { ok: true, jobId };
}

export function listImports(episodeId: string) {
  return db
    .select({ id: renderJobs.id, status: renderJobs.status, progress: renderJobs.progress, settings: renderJobs.settings, summary: renderJobs.summary, error: renderJobs.error, assetId: renderJobs.assetId, createdAt: renderJobs.createdAt, cancelRequested: renderJobs.cancelRequested })
    .from(renderJobs)
    .where(and(eq(renderJobs.episodeId, episodeId), eq(renderJobs.kind, "import")))
    .orderBy(desc(renderJobs.createdAt))
    .limit(30)
    .all();
}

/** Delete the original file's asset and object (the decoded asset is handled by the caller). */
export async function deleteAssetAndObject(assetId: string | undefined | null) {
  if (!assetId) return;
  const a = db.select().from(assets).where(eq(assets.id, assetId)).get();
  const t = a && db.select().from(storageTargets).where(eq(storageTargets.id, a.storageTargetId)).get();
  if (a && t) {
    const c = clientFor(t);
    try {
      await c.send(new DeleteObjectCommand({ Bucket: t.bucket, Key: a.key }));
      if (a.kind === "raw_audio") await c.send(new DeleteObjectCommand({ Bucket: t.bucket, Key: `${a.key}.peaks1` }));
    } finally {
      c.destroy();
    }
  }
  if (a) db.delete(assets).where(eq(assets.id, a.id)).run();
}
