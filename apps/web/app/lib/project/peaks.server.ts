import type { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { db, assets, recordings, storageTargets } from "@podstudio/db";
import { clientFor } from "~/lib/media.server";
import { PeakBuilder, parsePeaks } from "~/lib/project/peaks";

// Server-only. Peaks for a recording's WAV, computed once by streaming the file (never
// held in memory) and cached beside it on the same private storage target.

const WAV_HEADER = 44;
const cacheKey = (key: string) => `${key}.peaks1`;
const inflight = new Map<string, Promise<Uint8Array | null>>();

export function recordingPeaks(recId: string): Promise<Uint8Array | null> {
  const rec = db.select({ a: recordings.finalAssetId }).from(recordings).where(eq(recordings.id, recId)).get();
  return rec?.a ? assetPeaks(rec.a) : Promise.resolve(null);
}

export function assetPeaks(assetId: string): Promise<Uint8Array | null> {
  let p = inflight.get(assetId);
  if (!p) {
    p = build(assetId).finally(() => inflight.delete(assetId));
    inflight.set(assetId, p);
  }
  return p;
}

async function build(assetId: string): Promise<Uint8Array | null> {
  const asset = db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.kind, "raw_audio"), eq(assets.status, "verified"))).get();
  const target = asset && db.select().from(storageTargets).where(eq(storageTargets.id, asset.storageTargetId)).get();
  if (!asset || !target) return null;
  const client = clientFor(target);
  try {
    try {
      const hit = await client.send(new GetObjectCommand({ Bucket: target.bucket, Key: cacheKey(asset.key) }));
      const bytes = await hit.Body!.transformToByteArray();
      if (parsePeaks(bytes)) return bytes;
    } catch {
      // not cached yet
    }
    const obj = await client.send(new GetObjectCommand({ Bucket: target.bucket, Key: asset.key, Range: `bytes=${WAV_HEADER}-` }));
    const builder = new PeakBuilder();
    for await (const chunk of obj.Body as Readable) builder.push(chunk as Uint8Array);
    const file = builder.finish();
    await client.send(new PutObjectCommand({ Bucket: target.bucket, Key: cacheKey(asset.key), Body: file, ContentType: "application/octet-stream" }));
    return file;
  } finally {
    client.destroy();
  }
}

export function peaksKeyFor(assetKey: string) {
  return cacheKey(assetKey);
}
