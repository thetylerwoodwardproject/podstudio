import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { db, assets, storageTargets } from "@podstudio/db";
import { ARTWORK_MAX_BYTES, type ImageInfo } from "~/lib/image-info";
import { clientFor, routedTarget } from "~/lib/media.server";

// Server-only helpers shared by image uploads (episode artwork) and every public
// image route (show artwork, headshots, episode artwork): read a capped body,
// store + read back + hash-verify an image, delete it, and stream it — either the
// original or a thumbnail that is generated on first request and kept next to it.

const EXT = { png: "png", jpeg: "jpg" } as const;
const TYPE = { png: "image/png", jpeg: "image/jpeg" } as const;

export async function readCapped(
  body: ReadableStream<Uint8Array>,
  cap = ARTWORK_MAX_BYTES,
): Promise<{ ok: true; buf: Buffer } | { ok: false; status: number; error: string }> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > cap) {
      await reader.cancel().catch(() => {});
      return { ok: false, status: 413, error: `The image must be under ${cap / 1024 / 1024} MB.` };
    }
    chunks.push(value);
  }
  return { ok: true, buf: Buffer.concat(chunks) };
}

export type StoredImage = { ok: true; assetId: string } | { ok: false; status: number; error: string };

/** Uploads to the public feedMedia target and only reports success after reading it back byte-for-byte. */
export async function storeVerifiedImage(input: {
  showId: string;
  episodeId?: string | null;
  kind: string;
  keyPrefix: string;
  buf: Buffer;
  info: ImageInfo;
}): Promise<StoredImage> {
  const target = routedTarget("feedMedia");
  if (!target) return { ok: false, status: 409, error: "No storage target is routed for feed media. Set one up in Storage." };
  const sha256 = createHash("sha256").update(input.buf).digest("hex");
  const assetId = crypto.randomUUID();
  const key = `${input.keyPrefix}/${assetId}.${EXT[input.info.type]}`;
  db.insert(assets)
    .values({
      id: assetId,
      showId: input.showId,
      episodeId: input.episodeId ?? null,
      kind: input.kind,
      access: "public",
      storageTargetId: target.id,
      key,
      filename: key.split("/").pop()!,
      contentType: TYPE[input.info.type],
      status: "pending",
      createdAt: Date.now(),
    })
    .run();
  const client = clientFor(target);
  try {
    await client.send(new PutObjectCommand({ Bucket: target.bucket, Key: key, Body: input.buf, ContentType: TYPE[input.info.type] }));
    const head = await client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: key }));
    if (head.ContentLength !== input.buf.length) throw new Error(`Stored size ${head.ContentLength} doesn't match ${input.buf.length} bytes.`);
    const obj = await client.send(new GetObjectCommand({ Bucket: target.bucket, Key: key }));
    const back = createHash("sha256");
    for await (const c of obj.Body as Readable) back.update(c as Buffer);
    if (back.digest("hex") !== sha256) throw new Error("Stored bytes don't match what was uploaded.");
    db.update(assets)
      .set({ status: "verified", bytes: input.buf.length, sha256, meta: { width: input.info.width, height: input.info.height }, verifiedAt: Date.now() })
      .where(eq(assets.id, assetId))
      .run();
    return { ok: true, assetId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(assets).set({ status: "failed", error: message.slice(0, 500) }).where(eq(assets.id, assetId)).run();
    await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: key })).catch(() => {});
    return { ok: false, status: 502, error: `Upload failed: ${message}` };
  } finally {
    client.destroy();
  }
}

const thumbKey = (key: string) => key.replace(/\.(png|jpg)$/, "-s.$1");

/** Deletes the object (and its thumbnail, if one was made) and the row. Best-effort on storage. */
export async function removeImageAsset(assetId: string) {
  const asset = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!asset) return;
  const target = db.select().from(storageTargets).where(eq(storageTargets.id, asset.storageTargetId)).get();
  if (target) {
    const client = clientFor(target);
    try {
      for (const Key of [asset.key, thumbKey(asset.key)]) {
        await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key })).catch(() => {});
      }
    } finally {
      client.destroy();
    }
  }
  db.delete(assets).where(eq(assets.id, assetId)).run();
}

export interface ServableImage {
  key: string;
  targetId: string;
  contentType: string;
  bytes: number | null;
  sha256: string | null;
}

/**
 * Streams the original, or a thumbnail whose longest side is `edge` px. The thumbnail is
 * generated from the stored original the first time it is asked for and then kept in the
 * bucket beside it, so nothing needs backfilling and a missing thumbnail heals itself.
 */
export async function imageResponse(img: ServableImage, opts: { thumb: boolean; edge: number }) {
  const target = db.select().from(storageTargets).where(eq(storageTargets.id, img.targetId)).get();
  if (!target) return null;
  const client = clientFor(target);
  try {
    let key = img.key;
    let length: number | undefined = img.bytes ?? undefined;
    if (opts.thumb) {
      key = thumbKey(img.key);
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: key }));
        length = head.ContentLength;
      } catch {
        const orig = await client.send(new GetObjectCommand({ Bucket: target.bucket, Key: img.key }));
        const chunks: Buffer[] = [];
        for await (const c of orig.Body as Readable) chunks.push(c as Buffer);
        const pipeline = sharp(Buffer.concat(chunks)).rotate().resize({ width: opts.edge, height: opts.edge, fit: "inside", withoutEnlargement: true });
        const out = img.contentType === "image/png" ? await pipeline.png({ compressionLevel: 9 }).toBuffer() : await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
        await client.send(new PutObjectCommand({ Bucket: target.bucket, Key: key, Body: out, ContentType: img.contentType }));
        client.destroy();
        return { body: out, length: out.length };
      }
    }
    const obj = await client.send(new GetObjectCommand({ Bucket: target.bucket, Key: key }));
    const body = obj.Body as Readable;
    body.on("close", () => client.destroy());
    return { body, length };
  } catch (err) {
    client.destroy();
    throw err;
  }
}
