import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import type { storageTargets } from "@podstudio/db";

// Server-only: real S3 credentials live in env vars named by `keyRef`, never
// in the database or the browser (CLAUDE.md's secrets rule, same pattern as
// BETTER_AUTH_SECRET/PODSTUDIO_ADMIN_PASSWORD). A target's `keyRef` of
// "primary" expects PODSTUDIO_S3_PRIMARY_ACCESS_KEY_ID and
// PODSTUDIO_S3_PRIMARY_SECRET_ACCESS_KEY in deploy/.env.
function envNames(keyRef: string) {
  const upper = keyRef.toUpperCase().replace(/-/g, "_");
  return {
    accessKeyId: `PODSTUDIO_S3_${upper}_ACCESS_KEY_ID`,
    secretAccessKey: `PODSTUDIO_S3_${upper}_SECRET_ACCESS_KEY`,
  };
}

export type StorageTarget = typeof storageTargets.$inferSelect;

export async function testStorageConnection(
  target: StorageTarget,
): Promise<{ ok: boolean; message: string }> {
  const names = envNames(target.keyRef);
  const accessKeyId = process.env[names.accessKeyId];
  const secretAccessKey = process.env[names.secretAccessKey];

  if (!accessKeyId || !secretAccessKey) {
    return {
      ok: false,
      message: `No credentials configured for key reference "${target.keyRef}" — set ${names.accessKeyId} and ${names.secretAccessKey} in deploy/.env.`,
    };
  }

  const client = new S3Client({
    endpoint: target.endpoint ?? undefined,
    region: target.region ?? "us-east-1",
    forcePathStyle: target.provider !== "aws",
    credentials: { accessKeyId, secretAccessKey },
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
