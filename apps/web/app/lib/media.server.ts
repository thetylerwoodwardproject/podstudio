import { Readable, Transform } from "node:stream";
import { createHash } from "node:crypto";
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { looksLikeMp3 } from "~/lib/audio-check";
import { parseStream } from "music-metadata";
import { and, eq } from "drizzle-orm";
import { db, assets, episodes, shows, storageTargets, type StorageRoute } from "@podstudio/db";

// Server-only (see storage.server.ts for why all db access lives in .server files).
//
// Episode audio goes to whichever target is routed for "feedMedia" (the public
// bucket): the MP3 is the feed enclosure, so it is the one asset that must be
// publicly servable. An asset row starts "pending" and only becomes "verified"
// after the object has been read back from the bucket (size matches what was
// received, audio parses as MPEG with a duration) — an upload call returning is
// not treated as proof. Bytes stream through; nothing is buffered whole in RAM.

export const MAX_AUDIO_BYTES = 500 * 1024 * 1024;

type TargetRow = typeof storageTargets.$inferSelect;

export function clientFor(target: TargetRow) {
  return new S3Client({
    endpoint: target.endpoint ?? undefined,
    region: target.region ?? "us-east-1",
    forcePathStyle: target.provider !== "aws",
    credentials: { accessKeyId: target.accessKeyId, secretAccessKey: target.secretAccessKey },
  });
}

export function routedTarget(route: StorageRoute): TargetRow | null {
  const all = db.select().from(storageTargets).all();
  return all.find((t) => (t.routes as StorageRoute[] | null)?.includes(route)) ?? null;
}

export function hasFeedMediaTarget() {
  return routedTarget("feedMedia") !== null;
}

export type UploadResult = { ok: true; assetId: string } | { ok: false; error: string; status: number };

class UploadRejected extends Error {}

export async function uploadEpisodeAudio(input: {
  episodeId: string;
  filename: string;
  contentType: string;
  contentLength: number | null;
  body: ReadableStream<Uint8Array> | null;
}): Promise<UploadResult> {
  const episode = db.select().from(episodes).where(eq(episodes.id, input.episodeId)).get();
  if (!episode) return { ok: false, error: "Episode not found.", status: 404 };
  if (!input.body) return { ok: false, error: "No file received.", status: 400 };
  if (!/\.mp3$/i.test(input.filename)) return { ok: false, error: "Only .mp3 files can be uploaded.", status: 415 };
  if (input.contentLength !== null && input.contentLength > MAX_AUDIO_BYTES) {
    return { ok: false, error: `File is larger than ${MAX_AUDIO_BYTES / 1024 / 1024} MB.`, status: 413 };
  }
  if (input.contentLength === 0) return { ok: false, error: "The file is empty.", status: 400 };
  const target = routedTarget("feedMedia");
  if (!target) {
    return { ok: false, error: "No storage target is routed for feed media. Set one up in Storage.", status: 409 };
  }

  const assetId = crypto.randomUUID();
  const key = `audio/${episode.publicId}/${assetId}.mp3`;
  const now = Date.now();
  db.insert(assets)
    .values({
      id: assetId,
      showId: episode.showId,
      episodeId: episode.id,
      kind: "episode_audio",
      access: "public",
      storageTargetId: target.id,
      key,
      filename: input.filename.slice(0, 200),
      contentType: "audio/mpeg",
      status: "pending",
      createdAt: now,
    })
    .run();

  const client = clientFor(target);
  const hash = createHash("sha256");
  let received = 0;
  let first = true;
  let source: Readable | null = null;
  let rejection: UploadRejected | null = null; // set by the tap; survives however the SDK wraps the stream error
  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      if (first) {
        first = false;
        if (!looksLikeMp3(chunk)) {
          rejection = new UploadRejected("That file doesn't look like an MP3.");
          return cb(rejection);
        }
      }
      received += chunk.length;
      if (received > MAX_AUDIO_BYTES) {
        rejection = new UploadRejected(`File is larger than ${MAX_AUDIO_BYTES / 1024 / 1024} MB.`);
        return cb(rejection);
      }
      hash.update(chunk);
      cb(null, chunk);
    },
  });

  try {
    source = Readable.fromWeb(input.body as import("node:stream/web").ReadableStream<Uint8Array>);
    const src = source;
    src.on("error", (e) => tap.destroy(e));
    const upload = new Upload({
      client,
      params: { Bucket: target.bucket, Key: key, Body: src.pipe(tap), ContentType: "audio/mpeg" },
      queueSize: 3,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false,
    });
    await upload.done();
    if (received === 0) throw new UploadRejected("The file is empty.");

    // Read it back before believing it.
    const head = await client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: key }));
    if (head.ContentLength !== received) {
      throw new Error(`Stored size ${head.ContentLength} doesn't match received ${received} bytes.`);
    }
    const obj = await client.send(new GetObjectCommand({ Bucket: target.bucket, Key: key }));
    let meta: Awaited<ReturnType<typeof parseStream>>;
    try {
      meta = await parseStream(obj.Body as Readable, { mimeType: "audio/mpeg", size: received }, { duration: true });
    } catch {
      throw new UploadRejected("Couldn't read valid MP3 audio from that file.");
    } finally {
      (obj.Body as Readable).destroy();
    }
    const duration = meta.format.duration;
    if (!meta.format.codec?.toLowerCase().includes("mpeg") || !duration || duration < 1) {
      throw new UploadRejected("Couldn't read valid MP3 audio from that file.");
    }

    const verifiedAt = Date.now();
    const previous = episode.audioAssetId;
    db.transaction((tx) => {
      tx.update(assets)
        .set({
          status: "verified",
          bytes: received,
          sha256: hash.digest("hex"),
          durationS: Math.round(duration),
          sampleRate: meta.format.sampleRate ?? null,
          channels: meta.format.numberOfChannels ?? null,
          verifiedAt,
        })
        .where(eq(assets.id, assetId))
        .run();
      tx.update(episodes)
        .set({ audioAssetId: assetId, durationS: Math.round(duration), updatedAt: verifiedAt })
        .where(eq(episodes.id, episode.id))
        .run();
    });
    if (previous) await removeAsset(previous).catch(() => {});
    return { ok: true, assetId };
  } catch (caught) {
    await drainRest(source);
    const err = rejection ?? caught;
    const message = err instanceof Error ? err.message : String(err);
    db.update(assets).set({ status: "failed", error: message.slice(0, 500) }).where(eq(assets.id, assetId)).run();
    await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: key })).catch(() => {});
    const rejected = err instanceof UploadRejected;
    return { ok: false, error: rejected ? message : `Upload failed: ${message}`, status: rejected ? 422 : 502 };
  } finally {
    client.destroy();
  }
}

/** Deletes the stored object and its row. Best-effort on the object. */
export async function removeAsset(assetId: string) {
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

export async function removeEpisodeAudio(episodeId: string) {
  const episode = db.select().from(episodes).where(eq(episodes.id, episodeId)).get();
  if (!episode) return;
  db.update(episodes)
    .set({ audioAssetId: null, durationS: null, updatedAt: Date.now() })
    .where(eq(episodes.id, episodeId))
    .run();
  for (const a of db.select({ id: assets.id }).from(assets).where(and(eq(assets.episodeId, episodeId), eq(assets.kind, "episode_audio"))).all()) {
    await removeAsset(a.id).catch(() => {});
  }
}

export function getEpisodeAudio(episodeId: string) {
  return (
    db
      .select({
        id: assets.id,
        filename: assets.filename,
        bytes: assets.bytes,
        sha256: assets.sha256,
        durationS: assets.durationS,
        sampleRate: assets.sampleRate,
        channels: assets.channels,
        verifiedAt: assets.verifiedAt,
      })
      .from(episodes)
      .innerJoin(assets, and(eq(assets.id, episodes.audioAssetId), eq(assets.status, "verified")))
      .where(eq(episodes.id, episodeId))
      .get() ?? null
  );
}

// ---- Public serving (feed enclosure + player) -------------------------------
// Only a published + public episode's verified audio is ever served; anything
// else is indistinguishable from "not found". Bytes are proxied from the bucket
// (the storage service has no public port), with Range support so players can
// seek and resume.
export function findPublicAudio(slug: string, publicId: string) {
  return (
    db
      .select({
        key: assets.key,
        bytes: assets.bytes,
        sha256: assets.sha256,
        targetId: assets.storageTargetId,
      })
      .from(shows)
      .innerJoin(episodes, eq(episodes.showId, shows.id))
      .innerJoin(assets, and(eq(assets.id, episodes.audioAssetId), eq(assets.status, "verified")))
      .where(
        and(
          eq(shows.slug, slug),
          eq(episodes.publicId, publicId),
          eq(episodes.status, "published"),
          eq(episodes.visibility, "public"),
        ),
      )
      .get() ?? null
  );
}

export async function openAudio(
  audio: NonNullable<ReturnType<typeof findPublicAudio>>,
  range: { start: number; end: number } | null,
) {
  const target = db.select().from(storageTargets).where(eq(storageTargets.id, audio.targetId)).get();
  if (!target) return null;
  const client = clientFor(target);
  try {
    const obj = await client.send(
      new GetObjectCommand({
        Bucket: target.bucket,
        Key: audio.key,
        Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }),
    );
    const body = obj.Body as Readable;
    body.on("close", () => client.destroy());
    return body;
  } catch (err) {
    client.destroy();
    throw err;
  }
}

/** Swallows what's left of an abandoned upload body (bounded) so the HTTP reply isn't sent mid-upload. */
function drainRest(source: Readable | null): Promise<void> {
  if (!source || source.destroyed || source.readableEnded) return Promise.resolve();
  return new Promise((resolve) => {
    let seen = 0;
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      source.destroy();
      done();
    }, 15_000);
    source.unpipe();
    source.on("data", (chunk: Buffer) => {
      seen += chunk.length;
      if (seen > 32 * 1024 * 1024) {
        source.destroy();
        done();
      }
    });
    source.on("end", done);
    source.on("close", done);
    source.on("error", done);
    source.resume();
  });
}
