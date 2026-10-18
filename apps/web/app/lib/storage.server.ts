import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { db, storageTargets, type StorageProvider, type StorageRoute } from "@podstudio/db";

// Server-only (the `.server.ts` suffix is what keeps this out of the client
// bundle, per React Router's own convention — not just tree-shaking). ALL
// @podstudio/db access for screen 17 lives here, not in storage.tsx: a route
// file importing `storageTargets`/`db` directly — even only inside its
// loader/action — was enough to pull drizzle-orm's runtime into that route's
// client chunk and crash navigation to it (schema.ts constructs its tables
// at module-eval time, which Rollup couldn't prove side-effect-free once any
// of its named exports showed up in that chunk's import graph). Routing every
// DB call through this file sidesteps that; storage.tsx now imports nothing
// from @podstudio/db at all.
//
// Real S3 credentials are entered through the Storage screen's own form and
// stored in `storage_targets` directly — never in deploy/.env, per Tyler's
// direction that all settings go through the real web UI. They still never
// reach the browser after that: `listStorageTargets` omits `secretAccessKey`,
// and nothing else returns either key to a route response.
export type StorageTargetRow = Omit<
  typeof storageTargets.$inferSelect,
  "secretAccessKey"
>;

export function listStorageTargets(): StorageTargetRow[] {
  return db
    .select({
      id: storageTargets.id,
      provider: storageTargets.provider,
      label: storageTargets.label,
      endpoint: storageTargets.endpoint,
      bucket: storageTargets.bucket,
      region: storageTargets.region,
      accessKeyId: storageTargets.accessKeyId,
      routes: storageTargets.routes,
      createdAt: storageTargets.createdAt,
    })
    .from(storageTargets)
    .orderBy(storageTargets.createdAt)
    .all();
}

export function addStorageTarget(input: {
  provider: StorageProvider;
  label: string;
  endpoint: string | null;
  bucket: string;
  region: string | null;
  accessKeyId: string;
  secretAccessKey: string;
}) {
  db.insert(storageTargets)
    .values({ id: crypto.randomUUID(), routes: [], ...input })
    .run();
}

export function deleteStorageTarget(id: string) {
  db.delete(storageTargets).where(eq(storageTargets.id, id)).run();
}

export function updateStorageKeys(
  id: string,
  accessKeyId: string,
  secretAccessKey: string,
) {
  db.update(storageTargets)
    .set({ accessKeyId, secretAccessKey })
    .where(eq(storageTargets.id, id))
    .run();
}

export function setStorageRouting(selected: Record<StorageRoute, string>) {
  const targets = db.select().from(storageTargets).all();
  for (const target of targets) {
    const routes = (Object.entries(selected) as [StorageRoute, string][])
      .filter(([, targetId]) => targetId === target.id)
      .map(([route]) => route);
    db.update(storageTargets).set({ routes }).where(eq(storageTargets.id, target.id)).run();
  }
}

export async function testStorageConnectionById(
  id: string,
): Promise<{ ok: boolean; message: string } | null> {
  const target = db.select().from(storageTargets).where(eq(storageTargets.id, id)).get();
  if (!target) return null;

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
