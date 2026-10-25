import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { db, assets, shows, storageTargets } from "@podstudio/db";
import { artworkProblem, imageInfo, ARTWORK_MAX_BYTES } from "~/lib/image-info";
import { clientFor, routedTarget } from "~/lib/media.server";

// Server-only. Show artwork goes to the same public "feedMedia" target as episode
// audio and is only believed after read-back: stored size matches, and the bytes
// that come back hash to what was received. The feed points at /{slug}/artwork/
// {sha8}.{ext}, proxied from the bucket like the audio (the bucket has no public
// port); the hash in the name makes each upload a new immutable URL.

export type ArtworkResult = { ok: true } | { ok: false; error: string; status: number };

const EXT = { png: "png", jpeg: "jpg" } as const;
const TYPE = { png: "image/png", jpeg: "image/jpeg" } as const;

export function getShowArtwork() {
  return (
    db
      .select({
        id: assets.id,
        key: assets.key,
        targetId: assets.storageTargetId,
        contentType: assets.contentType,
        bytes: assets.bytes,
        sha256: assets.sha256,
        meta: assets.meta,
        slug: shows.slug,
      })
      .from(shows)
      .innerJoin(assets, and(eq(assets.id, shows.artworkAssetId), eq(assets.status, "verified")))
      .get() ?? null
  );
}

export function artworkFile(a: { sha256: string | null; contentType: string }) {
  return `${(a.sha256 ?? "").slice(0, 12)}.${a.contentType === "image/png" ? "png" : "jpg"}`;
}

export async function uploadShowArtwork(body: ReadableStream<Uint8Array> | null, declaredLength: number | null): Promise<ArtworkResult> {
  const show = db.select().from(shows).get();
  if (!show) return { ok: false, error: "No show.", status: 404 };
  if (!body) return { ok: false, error: "No file received.", status: 400 };
  if (declaredLength !== null && declaredLength > ARTWORK_MAX_BYTES) {
    return { ok: false, error: `Artwork must be under ${ARTWORK_MAX_BYTES / 1024 / 1024} MB.`, status: 413 };
  }
  const target = routedTarget("feedMedia");
  if (!target) return { ok: false, error: "No storage target is routed for feed media. Set one up in Storage.", status: 409 };

  // Read at most the cap (+1 byte to detect overflow); artwork is small, so it is buffered.
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > ARTWORK_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return { ok: false, error: `Artwork must be under ${ARTWORK_MAX_BYTES / 1024 / 1024} MB.`, status: 413 };
    }
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks);
  const info = imageInfo(buf);
  const problem = artworkProblem(info);
  if (problem || !info) return { ok: false, error: problem ?? "Unreadable image.", status: 422 };

  const sha256 = createHash("sha256").update(buf).digest("hex");
  const assetId = crypto.randomUUID();
  const key = `artwork/show/${assetId}.${EXT[info.type]}`;
  const previous = show.artworkAssetId;
  db.insert(assets)
    .values({
      id: assetId,
      showId: show.id,
      kind: "show_artwork",
      access: "public",
      storageTargetId: target.id,
      key,
      filename: key.split("/").pop()!,
      contentType: TYPE[info.type],
      status: "pending",
      createdAt: Date.now(),
    })
    .run();

  const client = clientFor(target);
  try {
    await client.send(new PutObjectCommand({ Bucket: target.bucket, Key: key, Body: buf, ContentType: TYPE[info.type] }));
    const head = await client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: key }));
    if (head.ContentLength !== buf.length) throw new Error(`Stored size ${head.ContentLength} doesn't match ${buf.length} bytes.`);
    const obj = await client.send(new GetObjectCommand({ Bucket: target.bucket, Key: key }));
    const back = createHash("sha256");
    for await (const c of obj.Body as Readable) back.update(c as Buffer);
    if (back.digest("hex") !== sha256) throw new Error("Stored bytes don't match what was uploaded.");

    const now = Date.now();
    db.transaction((tx) => {
      tx.update(assets)
        .set({ status: "verified", bytes: buf.length, sha256, meta: { width: info.width, height: info.height }, verifiedAt: now })
        .where(eq(assets.id, assetId))
        .run();
      tx.update(shows).set({ artworkAssetId: assetId }).where(eq(shows.id, show.id)).run();
    });
    if (previous) await removeAsset(previous).catch(() => {});
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(assets).set({ status: "failed", error: message.slice(0, 500) }).where(eq(assets.id, assetId)).run();
    await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: key })).catch(() => {});
    return { ok: false, error: `Upload failed: ${message}`, status: 502 };
  } finally {
    client.destroy();
  }
}

async function removeAsset(assetId: string) {
  const asset = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!asset) return;
  const target = db.select().from(storageTargets).where(eq(storageTargets.id, asset.storageTargetId)).get();
  if (target) {
    const client = clientFor(target);
    try {
      await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: asset.key }));
    } finally {
      client.destroy();
    }
  }
  db.delete(assets).where(eq(assets.id, assetId)).run();
}

export async function removeShowArtwork() {
  const show = db.select().from(shows).get();
  if (!show?.artworkAssetId) return;
  const id = show.artworkAssetId;
  db.update(shows).set({ artworkAssetId: null }).where(eq(shows.id, show.id)).run();
  await removeAsset(id).catch(() => {});
}

export async function openArtwork(a: NonNullable<ReturnType<typeof getShowArtwork>>) {
  const target = db.select().from(storageTargets).where(eq(storageTargets.id, a.targetId)).get();
  if (!target) return null;
  const client = clientFor(target);
  try {
    const obj = await client.send(new GetObjectCommand({ Bucket: target.bucket, Key: a.key }));
    const body = obj.Body as Readable;
    body.on("close", () => client.destroy());
    return body;
  } catch (err) {
    client.destroy();
    throw err;
  }
}
