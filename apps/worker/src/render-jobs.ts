// Export (render) jobs, Stage 04. Claims one queued job at a time, renders the exact project
// revision it names through the shared render path (@podstudio/audio), streams the WAV into the
// private "exports" bucket, then reads it back and checks size + header + SHA-256 before the job
// counts as verified. A lease, renewed while rendering, lets a restarted worker pick up work an
// earlier process abandoned; cancellation is polled between blocks. Not Stage 00's general runner.
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { DeleteObjectCommand, GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { assets, db, projectRevisions, renderJobs, sqlite, storageTargets } from "@podstudio/db";
import { parseProject } from "@podstudio/audio/document";
import { renderWav, type RenderSummary } from "@podstudio/audio/render";
import { PODCAST_LOUDNESS } from "@podstudio/audio/loudness";
import { importJob } from "./import-job";
import { Cancelled, LEASE_MS, clientFor, readBack, type Target } from "./storage";

const MAX_ATTEMPTS = 3;

/** Atomically take the next job: a queued one, or a running one whose lease lapsed. */
function claim(now = Date.now()): typeof renderJobs.$inferSelect | null {
  const take = sqlite.transaction(() => {
    const row = sqlite
      .prepare(
        `select id from render_jobs
          where (status = 'queued' or (status = 'running' and lease_until < ?))
          order by created_at limit 1`,
      )
      .get(now) as { id: string } | undefined;
    if (!row) return null;
    sqlite.prepare(`update render_jobs set status='running', lease_until=?, attempts=attempts+1, started_at=coalesce(started_at, ?) where id=?`).run(now + LEASE_MS, now, row.id);
    return row.id;
  });
  const id = take.immediate();
  return id ? (db.select().from(renderJobs).where(eq(renderJobs.id, id)).get() ?? null) : null;
}

function fail(id: string, message: string) {
  db.update(renderJobs).set({ status: "failed", error: message.slice(0, 500), finishedAt: Date.now(), leaseUntil: null }).where(eq(renderJobs.id, id)).run();
}

export async function runNextRenderJob(): Promise<boolean> {
  const job = claim();
  if (!job) return false;
  if (job.attempts > MAX_ATTEMPTS) {
    fail(job.id, "Gave up after the worker restarted several times while rendering.");
    return true;
  }
  console.log(`[worker] render ${job.id} (revision ${job.revisionSeq}, attempt ${job.attempts})`);
  try {
    await (job.kind === "import" ? importJob(job) : render(job));
  } catch (err) {
    const asked = db.select({ c: renderJobs.cancelRequested }).from(renderJobs).where(eq(renderJobs.id, job.id)).get()?.c;
    if (err instanceof Cancelled || asked) {
      console.log(`[worker] render ${job.id} cancelled`);
      db.update(renderJobs).set({ status: "cancelled", finishedAt: Date.now(), leaseUntil: null }).where(eq(renderJobs.id, job.id)).run();
    } else {
      console.error(`[worker] render ${job.id} failed:`, err);
      fail(job.id, err instanceof Error ? err.message : "Render failed");
    }
  }
  return true;
}

/** Renders, uploads and verifies one job; removes any partial object itself when it throws. */
async function render(job: typeof renderJobs.$inferSelect): Promise<void> {
  const settings = job.settings as { bitDepth: 16 | 24; sampleRate: 44100 | 48000; channels?: 1 | 2 };
  const channels = settings.channels ?? 1;
  if (job.kind !== "wav" || (settings.bitDepth !== 16 && settings.bitDepth !== 24) || (settings.sampleRate !== 44100 && settings.sampleRate !== 48000) || (channels !== 1 && channels !== 2)) throw new Error("Unsupported export settings.");
  // Every export is delivered at the podcast loudness standard: −19 LUFS mono / −16 LUFS stereo, ≤ −1 dBTP.
  const loudness = { targetLufs: channels === 1 ? PODCAST_LOUDNESS.mono : PODCAST_LOUDNESS.stereo, truePeakDb: PODCAST_LOUDNESS.truePeakDb };
  const rev = db.select().from(projectRevisions).where(eq(projectRevisions.id, job.projectRevisionId)).get();
  if (!rev) throw new Error("That project revision no longer exists.");
  const parsed = parseProject(rev.document);
  if (!parsed.ok) throw new Error(`The project revision is invalid: ${parsed.error}`);
  const doc = parsed.doc;
  if (doc.clips.length === 0) throw new Error("The project has no audio to export.");

  const targets = db.select().from(storageTargets).all();
  const out = targets.find((t) => (t.routes as string[] | null)?.includes("exports"));
  if (!out) throw new Error("No storage target is routed for exports. Set one up in Storage.");

  const epRow = sqlite.prepare("select show_id as showId from episodes where id = ?").get(job.episodeId) as { showId: string } | undefined;
  if (!epRow) throw new Error("The episode no longer exists.");

  // source audio, by Range, from wherever each source's asset lives
  const clients = new Map<string, S3Client>();
  const clientOf = (t: Target) => clients.get(t.id) ?? (clients.set(t.id, clientFor(t)), clients.get(t.id)!);
  const srcInfo = new Map<string, { target: Target; key: string }>();
  for (const s of doc.sources) {
    const a = db.select().from(assets).where(and(eq(assets.id, s.assetId), eq(assets.status, "verified"))).get();
    const t = a && targets.find((x) => x.id === a.storageTargetId);
    if (!a || !t) throw new Error(`The audio for "${s.label}" isn't available.`);
    srcInfo.set(s.id, { target: t, key: a.key });
  }
  const read = async (sourceId: string, from: number, count: number) => {
    const info = srcInfo.get(sourceId)!;
    const res = await clientOf(info.target).send(new GetObjectCommand({ Bucket: info.target.bucket, Key: info.key, Range: `bytes=${44 + from * 3}-${44 + (from + count) * 3 - 1}` }));
    const bytes = await res.Body!.transformToByteArray();
    if (bytes.length !== count * 3) throw new Error(`Short read from "${sourceId}": ${bytes.length} of ${count * 3} bytes`);
    const f = new Float32Array(count);
    for (let i = 0, o = 0; i < count; i++, o += 3) {
      let v = bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16);
      if (v & 0x800000) v |= ~0xffffff;
      f[i] = v < 0 ? v / 0x800000 : v / 0x7fffff;
    }
    return f;
  };

  const outClient = clientOf(out);
  const key = `exports/${job.episodeId}/${job.id}.wav`;
  const abort = new AbortController();
  let lastBeat = 0;
  let summary: RenderSummary | null = null;
  const sent = createHash("sha256");
  const stream = Readable.from(
    (async function* () {
      const gen = renderWav({
        doc,
        bitDepth: settings.bitDepth,
        sampleRate: settings.sampleRate,
        channels,
        loudness,
        read,
        onProgress: async (p) => {
          const now = Date.now();
          if (now - lastBeat < 1000 && p < 1) return;
          lastBeat = now;
          const row = db.select({ c: renderJobs.cancelRequested, s: renderJobs.status }).from(renderJobs).where(eq(renderJobs.id, job.id)).get();
          if (row?.c) throw new Cancelled();
          db.update(renderJobs).set({ progress: p, leaseUntil: now + LEASE_MS }).where(eq(renderJobs.id, job.id)).run();
        },
      });
      for (;;) {
        const n = await gen.next();
        if (n.done) {
          summary = n.value;
          return;
        }
        sent.update(n.value);
        yield n.value;
      }
    })(),
  );
  const removeObject = async () => {
    await outClient.send(new DeleteObjectCommand({ Bucket: out.bucket, Key: key })).catch(() => {});
  };
  const upload = new Upload({ client: outClient, params: { Bucket: out.bucket, Key: key, Body: stream, ContentType: "audio/wav" }, queueSize: 2, partSize: 8 * 1024 * 1024, abortController: abort });
  const finish = async () => {
    try {
      await upload.done();
    } catch (e) {
      stream.destroy();
      throw e;
    }
  };
  try {
    await finish();
  } catch (e) {
    await upload.abort().catch(() => {});
    await removeObject();
    for (const c of clients.values()) c.destroy();
    throw e;
  }
  const done = summary as RenderSummary | null;
  if (!done) {
    await removeObject();
    throw new Error("The render didn't finish.");
  }

  // read back: size, header and SHA-256 of what is really in the bucket
  try {
    const bytesPer = settings.bitDepth / 8;
    const expected = 44 + done.frames * bytesPer * channels;
    const { sha256, first } = await readBack(outClient, out.bucket, key, expected);
    if (first.length < 44 || first.toString("ascii", 0, 4) !== "RIFF" || first.readUInt32LE(24) !== settings.sampleRate || first.readUInt16LE(22) !== channels || first.readUInt16LE(34) !== settings.bitDepth || first.readUInt32LE(40) !== expected - 44) throw new Error("The stored WAV header is wrong.");
    if (sha256 !== sent.digest("hex")) throw new Error("The stored file doesn't match what was rendered (SHA-256 differs).");
    const now = Date.now();
    const assetId = crypto.randomUUID();
    sqlite.transaction(() => {
      db.insert(assets)
        .values({ id: assetId, showId: epRow.showId, episodeId: job.episodeId, kind: "export_wav", access: "private", storageTargetId: out.id, key, filename: `episode-r${job.revisionSeq}-${channels === 2 ? "stereo" : "mono"}-${loudness.targetLufs}LUFS-${settings.bitDepth}bit-${settings.sampleRate / 1000}k.wav`, contentType: "audio/wav", bytes: expected, sha256, durationS: Math.round(done.frames / settings.sampleRate), sampleRate: settings.sampleRate, channels, status: "verified", meta: { bitDepth: settings.bitDepth, samples: done.frames, peak: done.peak, clipped: done.clipped, revisionSeq: job.revisionSeq, integratedLufs: done.integratedLufs, truePeakDb: done.truePeakDb, lra: done.lra, normalise: done.normalise }, createdAt: now, verifiedAt: now })
        .run();
      db.update(renderJobs).set({ status: "verified", progress: 1, assetId, summary: { frames: done.frames, peak: done.peak, clipped: done.clipped, bytes: expected, sha256, integratedLufs: done.integratedLufs, truePeakDb: done.truePeakDb, lra: done.lra, normalise: done.normalise }, finishedAt: now, leaseUntil: null, error: null }).where(eq(renderJobs.id, job.id)).run();
    })();
  } catch (e) {
    await removeObject();
    throw e;
  } finally {
    for (const c of clients.values()) c.destroy();
  }
}
