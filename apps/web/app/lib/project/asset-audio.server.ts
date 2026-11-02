import type { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { assets, db, storageTargets } from "@podstudio/db";
import { clientFor } from "~/lib/media.server";

/** Private WAV of a verified raw_audio asset (recording or imported file), with optional byte range. */
export async function openAssetAudio(assetId: string, range: { start: number; end: number } | null) {
  const asset = db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.kind, "raw_audio"), eq(assets.status, "verified"))).get();
  const target = asset && db.select().from(storageTargets).where(eq(storageTargets.id, asset.storageTargetId)).get();
  if (!asset || !target) return null;
  const client = clientFor(target);
  try {
    const obj = await client.send(new GetObjectCommand({ Bucket: target.bucket, Key: asset.key, Range: range ? `bytes=${range.start}-${range.end}` : undefined }));
    const body = obj.Body as Readable;
    body.on("close", () => client.destroy());
    return { body, bytes: asset.bytes ?? 0, contentType: asset.contentType };
  } catch (err) {
    client.destroy();
    throw err;
  }
}
