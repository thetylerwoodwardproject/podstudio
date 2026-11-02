import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { storageTargets } from "@podstudio/db";

export type Target = typeof storageTargets.$inferSelect;

export const clientFor = (t: Target) =>
  new S3Client({
    endpoint: t.endpoint ?? undefined,
    region: t.region ?? "us-east-1",
    forcePathStyle: t.provider !== "aws",
    credentials: { accessKeyId: t.accessKeyId, secretAccessKey: t.secretAccessKey },
    // Garage reports a wrong CRC32 for whole multipart objects and the SDK then aborts the read.
    // Integrity is checked by us instead: SHA-256 of what was written vs what is read back.
    responseChecksumValidation: "WHEN_REQUIRED",
  });

/** Read an object back completely and return its size, SHA-256 and first 44 bytes. */
export async function readBack(client: S3Client, bucket: string, key: string, expectedBytes: number) {
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  if (head.ContentLength !== expectedBytes) throw new Error(`Stored ${head.ContentLength} bytes, expected ${expectedBytes}.`);
  const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const hash = createHash("sha256");
  let first: Buffer | null = null;
  let total = 0;
  for await (const chunk of obj.Body as Readable) {
    const b = chunk as Buffer;
    if (!first) first = b.subarray(0, 44);
    hash.update(b);
    total += b.length;
  }
  if (total !== expectedBytes) throw new Error(`Read back ${total} bytes, expected ${expectedBytes}.`);
  return { sha256: hash.digest("hex"), first: first ?? Buffer.alloc(0) };
}

export const LEASE_MS = 60_000;
export class Cancelled extends Error {}
