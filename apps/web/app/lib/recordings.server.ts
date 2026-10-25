import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { db, assets, episodes, recordingChunks, recordings, shows, storageTargets } from "@podstudio/db";
import { CAPTURE, wavHeader, type RetakeAnnotation } from "~/lib/capture-contract";
import { clientFor, routedTarget } from "~/lib/media.server";
import { analyseChunks } from "~/lib/recording-chunks";

// Server-only. Solo recordings (Stage 03). The browser uploads fixed-size PCM chunks;
// each is verified (declared size, SHA-256 of the bytes we received, read-back size)
// before it counts. A recording becomes a WAV only from a complete, contiguous set of
// chunks — a gap is reported, never papered over. Raw audio is private: it lives on
// the "raw" storage target and is only reachable through the authenticated studio.

type Fail = { ok: false; error: string; status: number };

export function createRecording(episodeId: string, input: { sampleRate: number; channels: number; device: unknown }): { ok: true; id: string } | Fail {
  const ep = db.select({ id: episodes.id, showId: episodes.showId }).from(episodes).where(eq(episodes.id, episodeId)).get();
  if (!ep) return { ok: false, error: "Episode not found.", status: 404 };
  if (input.sampleRate !== CAPTURE.sampleRate) return { ok: false, error: `Recordings are ${CAPTURE.sampleRate} Hz; the browser reported ${input.sampleRate}.`, status: 422 };
  if (input.channels !== CAPTURE.channels) return { ok: false, error: "Only mono recordings are supported.", status: 422 };
  if (!routedTarget("raw")) return { ok: false, error: "No storage target is routed for raw recordings. Set one up in Storage.", status: 409 };
  const id = crypto.randomUUID();
  db.insert(recordings)
    .values({ id, showId: ep.showId, episodeId, status: "recording", sampleRate: input.sampleRate, channels: input.channels, bitDepth: CAPTURE.bitDepth, device: input.device ?? null, annotations: [], startedAt: Date.now() })
    .run();
  return { ok: true, id };
}

const chunkKey = (recId: string, seq: number) => `recordings/${recId}/chunks/${String(seq).padStart(8, "0")}.pcm`;

/** Idempotent: re-sending a chunk with the same checksum is a no-op; a different checksum for the same sequence is a conflict. */
export async function putChunk(
  recId: string,
  seq: number,
  meta: { firstSample: number; sampleCount: number; sha256: string },
  body: ReadableStream<Uint8Array> | null,
): Promise<{ ok: true; duplicate: boolean } | Fail> {
  const rec = db.select().from(recordings).where(eq(recordings.id, recId)).get();
  if (!rec) return { ok: false, error: "Recording not found.", status: 404 };
  if (rec.status !== "recording") return { ok: false, error: `This recording is already ${rec.status}; it no longer accepts chunks.`, status: 409 };
  if (!Number.isInteger(seq) || seq < 0 || seq > 100_000) return { ok: false, error: "Bad chunk number.", status: 400 };
  if (!Number.isInteger(meta.firstSample) || meta.firstSample < 0) return { ok: false, error: "Bad first-sample position.", status: 400 };
  if (!Number.isInteger(meta.sampleCount) || meta.sampleCount < 1 || meta.sampleCount > CAPTURE.maxChunkSamples) return { ok: false, error: "Bad sample count.", status: 400 };
  if (!/^[0-9a-f]{64}$/.test(meta.sha256)) return { ok: false, error: "Bad checksum.", status: 400 };
  if (!body) return { ok: false, error: "No data received.", status: 400 };

  const expected = meta.sampleCount * rec.channels * CAPTURE.bytesPerSample;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > expected) {
      await reader.cancel().catch(() => {});
      return { ok: false, error: "Chunk is larger than its declared sample count.", status: 413 };
    }
    chunks.push(value);
  }
  if (size !== expected) return { ok: false, error: `Chunk is ${size} bytes; ${meta.sampleCount} samples should be ${expected}.`, status: 422 };
  const buf = Buffer.concat(chunks);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  if (sha256 !== meta.sha256) return { ok: false, error: "Checksum mismatch — the chunk was corrupted in transit. Send it again.", status: 422 };

  const existing = db.select().from(recordingChunks).where(and(eq(recordingChunks.recordingId, recId), eq(recordingChunks.sequence, seq))).get();
  if (existing) {
    if (existing.sha256 === sha256 && existing.firstSample === meta.firstSample && existing.sampleCount === meta.sampleCount) return { ok: true, duplicate: true };
    return { ok: false, error: `Chunk ${seq} was already stored with different content.`, status: 409 };
  }

  const target = routedTarget("raw");
  if (!target) return { ok: false, error: "No storage target is routed for raw recordings.", status: 409 };
  const key = chunkKey(recId, seq);
  const client = clientFor(target);
  try {
    await client.send(new PutObjectCommand({ Bucket: target.bucket, Key: key, Body: buf, ContentType: "application/octet-stream" }));
    const head = await client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: key }));
    if (head.ContentLength !== buf.length) throw new Error(`Stored size ${head.ContentLength} doesn't match ${buf.length} bytes.`);
  } catch (err) {
    await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: key })).catch(() => {});
    return { ok: false, error: `Storing the chunk failed: ${err instanceof Error ? err.message : String(err)}`, status: 502 };
  } finally {
    client.destroy();
  }
  db.insert(recordingChunks)
    .values({ recordingId: recId, sequence: seq, firstSample: meta.firstSample, sampleCount: meta.sampleCount, bytes: buf.length, sha256, key, storageTargetId: target.id, verifiedAt: Date.now() })
    .onConflictDoNothing()
    .run();
  return { ok: true, duplicate: false };
}

export function setAnnotations(recId: string, raw: unknown): { ok: true } | Fail {
  const rec = db.select({ id: recordings.id, status: recordings.status }).from(recordings).where(eq(recordings.id, recId)).get();
  if (!rec) return { ok: false, error: "Recording not found.", status: 404 };
  if (!Array.isArray(raw) || raw.length > 500) return { ok: false, error: "Bad annotations.", status: 400 };
  const clean: RetakeAnnotation[] = [];
  for (const a of raw) {
    if (!a || a.type !== "retake" || !Number.isInteger(a.sample) || a.sample < 0 || typeof a.atS !== "number") return { ok: false, error: "Bad annotation.", status: 400 };
    clean.push({ type: "retake", sample: a.sample, atS: a.atS });
  }
  clean.sort((x, y) => x.sample - y.sample);
  db.update(recordings).set({ annotations: clean }).where(eq(recordings.id, recId)).run();
  return { ok: true };
}

export function getRecordingStatus(recId: string) {
  const rec = db.select().from(recordings).where(eq(recordings.id, recId)).get();
  if (!rec) return null;
  const rows = db.select({ sequence: recordingChunks.sequence, firstSample: recordingChunks.firstSample, sampleCount: recordingChunks.sampleCount }).from(recordingChunks).where(eq(recordingChunks.recordingId, recId)).orderBy(asc(recordingChunks.sequence)).all();
  const a = analyseChunks(rows);
  return {
    id: rec.id,
    episodeId: rec.episodeId,
    status: rec.status,
    sampleRate: rec.sampleRate,
    totalSamples: rec.totalSamples,
    annotations: (rec.annotations ?? []) as RetakeAnnotation[],
    report: rec.report as Record<string, unknown> | null,
    error: rec.error,
    finalAssetId: rec.finalAssetId,
    chunks: { stored: rows.length, contiguousThrough: a.prefixChunks, contiguousSamples: a.prefixSamples, haveSequences: rows.map((r) => r.sequence) },
  };
}

async function deleteObjects(targetId: string, keys: string[]) {
  const target = db.select().from(storageTargets).where(eq(storageTargets.id, targetId)).get();
  if (!target || keys.length === 0) return;
  const client = clientFor(target);
  try {
    for (const Key of keys) await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key })).catch(() => {});
  } finally {
    client.destroy();
  }
}

export type FinalizeResult =
  | { ok: true; status: "complete" | "incomplete"; samples: number; durationS: number; report: Record<string, unknown> | null }
  | (Fail & { missing?: { fromSequence: number; toSequence: number }[] });

/**
 * Builds the WAV from the verified chunks. Refuses to cross a gap unless `allowPartial`
 * (then it keeps the contiguous start and records what was lost). Streams chunk by
 * chunk — nothing is held whole in memory.
 */
export async function finalizeRecording(
  recId: string,
  input: { chunkCount?: number; totalSamples?: number; lostTailSamples?: number; allowPartial?: boolean },
): Promise<FinalizeResult> {
  const claimed = db
    .update(recordings)
    .set({ status: "finalizing", endedAt: Date.now(), error: null })
    .where(and(eq(recordings.id, recId), inArray(recordings.status, ["recording", "failed"])))
    .returning()
    .get();
  if (!claimed) {
    const cur = db.select({ status: recordings.status }).from(recordings).where(eq(recordings.id, recId)).get();
    return { ok: false, error: cur ? `This recording is already ${cur.status}.` : "Recording not found.", status: cur ? 409 : 404 };
  }
  const revert = (error: string) => db.update(recordings).set({ status: "recording", error }).where(eq(recordings.id, recId)).run();

  const rows = db.select().from(recordingChunks).where(eq(recordingChunks.recordingId, recId)).orderBy(asc(recordingChunks.sequence)).all();
  if (rows.length === 0) {
    revert("No audio has been uploaded yet.");
    return { ok: false, error: "No audio has been uploaded yet.", status: 409 };
  }
  const a = analyseChunks(rows);
  const declaredChunks = input.chunkCount ?? a.totalChunks;
  const missing = [...a.gaps];
  if (!a.complete || rows.length !== declaredChunks) {
    // chunks the client says exist but never arrived (a missing tail)
    if (rows.length < declaredChunks && a.gaps.length === 0 && a.prefixChunks === rows.length) missing.push({ fromSequence: rows.length, toSequence: declaredChunks - 1 });
    if (!input.allowPartial) {
      revert("Some chunks are missing.");
      return { ok: false, error: "Some chunks haven't arrived, so the recording can't be finalized without a gap.", status: 409, missing };
    }
  }
  const useChunks = rows.slice(0, a.prefixChunks);
  if (useChunks.length === 0) {
    revert("The first chunk is missing.");
    return { ok: false, error: "The first chunk never arrived, so there is nothing contiguous to finalize.", status: 409, missing };
  }
  const samples = a.prefixSamples;
  const target = routedTarget("raw");
  if (!target) {
    revert("No raw storage target.");
    return { ok: false, error: "No storage target is routed for raw recordings.", status: 409 };
  }

  const dataBytes = samples * claimed.channels * CAPTURE.bytesPerSample;
  const header = wavHeader({ sampleRate: claimed.sampleRate, channels: claimed.channels, bitDepth: claimed.bitDepth }, dataBytes);
  const client = clientFor(target);
  const assetId = crypto.randomUUID();
  const key = `recordings/${recId}/${assetId}.wav`;
  const hash = createHash("sha256");
  try {
    async function* parts() {
      hash.update(header);
      yield Buffer.from(header);
      for (const c of useChunks) {
        const obj = await client.send(new GetObjectCommand({ Bucket: target!.bucket, Key: c.key }));
        let got = 0;
        for await (const part of obj.Body as Readable) {
          got += (part as Buffer).length;
          hash.update(part as Buffer);
          yield part as Buffer;
        }
        if (got !== c.bytes) throw new Error(`Chunk ${c.sequence} read back as ${got} bytes, expected ${c.bytes}.`);
      }
    }
    await new Upload({ client, params: { Bucket: target.bucket, Key: key, Body: Readable.from(parts()), ContentType: "audio/wav" }, queueSize: 2, partSize: 8 * 1024 * 1024 }).done();
    const head = await client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: key }));
    if (head.ContentLength !== 44 + dataBytes) throw new Error(`Stored WAV is ${head.ContentLength} bytes, expected ${44 + dataBytes}.`);
  } catch (err) {
    await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: key })).catch(() => {});
    client.destroy();
    const msg = err instanceof Error ? err.message : String(err);
    db.update(recordings).set({ status: "failed", error: msg.slice(0, 500) }).where(eq(recordings.id, recId)).run();
    return { ok: false, error: `Assembling the WAV failed: ${msg}`, status: 502 };
  }
  client.destroy();

  const lostTail = Math.max(0, input.lostTailSamples ?? 0);
  const clientTotal = input.totalSamples ?? samples;
  const lostByGap = Math.max(0, clientTotal - samples);
  const incomplete = missing.length > 0 || lostTail > 0 || lostByGap > 0;
  const report = incomplete
    ? { gaps: missing, lostTailSamples: lostTail, missingSamples: lostByGap, usedChunks: useChunks.length, droppedChunks: rows.length - useChunks.length }
    : null;
  const now = Date.now();
  const sha256 = hash.digest("hex");
  db.transaction((tx) => {
    tx.insert(assets)
      .values({ id: assetId, showId: claimed.showId, episodeId: claimed.episodeId, kind: "raw_audio", access: "private", storageTargetId: target.id, key, filename: `recording-${recId.slice(0, 8)}.wav`, contentType: "audio/wav", bytes: 44 + dataBytes, sha256, durationS: Math.round(samples / claimed.sampleRate), sampleRate: claimed.sampleRate, channels: claimed.channels, status: "verified", meta: { bitDepth: claimed.bitDepth, samples }, createdAt: now, verifiedAt: now })
      .run();
    tx.update(recordings).set({ status: incomplete ? "incomplete" : "complete", totalSamples: samples, finalAssetId: assetId, report, finalizedAt: now }).where(eq(recordings.id, recId)).run();
    tx.delete(recordingChunks).where(eq(recordingChunks.recordingId, recId)).run();
  });
  await deleteObjects(target.id, rows.map((r) => r.key));
  return { ok: true, status: incomplete ? "incomplete" : "complete", samples, durationS: samples / claimed.sampleRate, report };
}

export function listRecordingsForEpisode(episodeId: string) {
  return db
    .select({
      id: recordings.id,
      status: recordings.status,
      startedAt: recordings.startedAt,
      totalSamples: recordings.totalSamples,
      sampleRate: recordings.sampleRate,
      annotations: recordings.annotations,
      report: recordings.report,
      finalAssetId: recordings.finalAssetId,
      bytes: assets.bytes,
      sha256: assets.sha256,
    })
    .from(recordings)
    .leftJoin(assets, eq(assets.id, recordings.finalAssetId))
    .where(eq(recordings.episodeId, episodeId))
    .orderBy(desc(recordings.startedAt))
    .all()
    .map((r) => ({ ...r, annotations: (r.annotations ?? []) as RetakeAnnotation[] }));
}

export async function deleteRecording(recId: string) {
  const rec = db.select().from(recordings).where(eq(recordings.id, recId)).get();
  if (!rec) return;
  const chunks = db.select().from(recordingChunks).where(eq(recordingChunks.recordingId, recId)).all();
  if (chunks.length) await deleteObjects(chunks[0]!.storageTargetId, chunks.map((c) => c.key));
  db.delete(recordingChunks).where(eq(recordingChunks.recordingId, recId)).run();
  if (rec.finalAssetId) {
    const asset = db.select().from(assets).where(eq(assets.id, rec.finalAssetId)).get();
    if (asset) {
      await deleteObjects(asset.storageTargetId, [asset.key]);
      db.update(recordings).set({ finalAssetId: null }).where(eq(recordings.id, recId)).run();
      db.delete(assets).where(eq(assets.id, asset.id)).run();
    }
  }
  db.delete(recordings).where(eq(recordings.id, recId)).run();
}

export async function deleteRecordingsForEpisode(episodeId: string) {
  for (const r of db.select({ id: recordings.id }).from(recordings).where(eq(recordings.episodeId, episodeId)).all()) await deleteRecording(r.id);
}

/** Private WAV for playback in the studio (with HTTP Range support). */
export async function openRecordingAudio(recId: string, range: { start: number; end: number } | null) {
  const rec = db.select().from(recordings).where(eq(recordings.id, recId)).get();
  if (!rec?.finalAssetId) return null;
  const asset = db.select().from(assets).where(and(eq(assets.id, rec.finalAssetId), eq(assets.status, "verified"))).get();
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

/** Everything the solo screen needs for one episode (null if it doesn't exist). */
export function getSoloContext(episodeId: string) {
  const ep = db.select().from(episodes).where(eq(episodes.id, episodeId)).get();
  if (!ep) return null;
  const show = db.select({ title: shows.title }).from(shows).where(eq(shows.id, ep.showId)).get();
  return {
    episode: { id: ep.id, title: ep.title, number: ep.number, showTitle: show?.title ?? "", script: ep.script ?? "" },
    recordings: listRecordingsForEpisode(episodeId).map((r) => ({
      id: r.id,
      status: r.status,
      startedAt: r.startedAt,
      totalSamples: r.totalSamples,
      annotations: r.annotations,
      report: r.report as { gaps?: unknown[]; lostTailSamples?: number; missingSamples?: number } | null,
      bytes: r.bytes,
    })),
    storageReady: routedTarget("raw") !== null,
  };
}

export function listEpisodesToRecord() {
  return db
    .select({ id: episodes.id, title: episodes.title, number: episodes.number, status: episodes.status })
    .from(episodes)
    .orderBy(desc(episodes.number))
    .all();
}

export function saveScript(episodeId: string, script: string) {
  db.update(episodes).set({ script: script.slice(0, 100_000) || null, updatedAt: Date.now() }).where(eq(episodes.id, episodeId)).run();
}
