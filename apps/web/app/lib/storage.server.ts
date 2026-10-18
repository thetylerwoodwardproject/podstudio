import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import type { storageTargets } from "@podstudio/db";

// Server-only. Real S3 credentials are entered through the Storage screen's
// own form and stored in `storage_targets` — never in deploy/.env, per
// Tyler's direction that all settings go through the real web UI. They still
// never reach the browser after that: callers of this module only pass in a
// full row fetched server-side, and no route ever echoes `secretAccessKey`
// back out (see storage.tsx's loader, which selects every column except it).
export type StorageTarget = typeof storageTargets.$inferSelect;

export async function testStorageConnection(
  target: StorageTarget,
): Promise<{ ok: boolean; message: string }> {
  const client = new S3Client({
    endpoint: target.endpoint ?? undefined,
    region: target.region ?? "us-east-1",
    forcePathStyle: target.provider !== "aws",
    credentials: {
      accessKeyId: target.accessKeyId,
      secretAccessKey: target.secretAccessKey,
    },
  });

  try {
    await client.send(new HeadBucketCommand({ Bucket: target.bucket }));
    return { ok: true, message: `Connected — "${target.bucket}" is reachable.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Connection failed: ${message}` };
  } finally {
    client.destroy();
  }
}
