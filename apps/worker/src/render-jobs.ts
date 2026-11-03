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
import { importJob, run } from "./import-job";
import { DELIVERY_PRESETS, DELIVERY_RATE, isDeliveryPreset, loudnessTarget } from "@podstudio/audio/delivery";
import { LoudnessMeter, TruePeakMeter } from "@podstudio/audio/loudness";
import { loudnessDiagnostics, type Diagnostic } from "@podstudio/audio/render";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    await (job.kind === "import" ? importJob(job) : job.kind === "mp3" ? renderMp3(job) : render(job));
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

/** Everything a render needs: the parsed revision, the export target, and a reader for every source. */
function prepareRender(job: typeof renderJobs.$inferSelect) {
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
  const srcInfo = new Map<string, { target: Target; key: string; channels: 1 | 2 }>();
  for (const s of doc.sources) {
    const a = db.select().from(assets).where(and(eq(assets.id, s.assetId), eq(assets.status, "verified"))).get();
    const t = a && targets.find((x) => x.id === a.storageTargetId);
    if (!a || !t) throw new Error(`The audio for "${s.label}" isn't available.`);
    srcInfo.set(s.id, { target: t, key: a.key, channels: a.channels === 2 ? 2 : 1 });
  }
  const read = async (sourceId: string, from: number, count: number): Promise<Float32Array[]> => {
    const info = srcInfo.get(sourceId)!;
    const ch = info.channels;
    const frameBytes = 3 * ch;
    const res = await clientOf(info.target).send(new GetObjectCommand({ Bucket: info.target.bucket, Key: info.key, Range: `bytes=${44 + from * frameBytes}-${44 + (from + count) * frameBytes - 1}` }));
    const bytes = await res.Body!.transformToByteArray();
    if (bytes.length !== count * frameBytes) throw new Error(`Short read from "${sourceId}": ${bytes.length} of ${count * frameBytes} bytes`);
    const out = Array.from({ length: ch }, () => new Float32Array(count));
    for (let i = 0, o = 0; i < count; i++) {
      for (let c = 0; c < ch; c++, o += 3) {
        let v = bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16);
        if (v & 0x800000) v |= ~0xffffff;
        out[c]![i] = v < 0 ? v / 0x800000 : v / 0x7fffff;
      }
    }
    return out;
  };

  return { doc, epRow, out, clients, clientOf, read };
}

/** Renders, uploads and verifies one job; removes any partial object itself when it throws. */
async function render(job: typeof renderJobs.$inferSelect): Promise<void> {
  const settings = job.settings as { bitDepth: 16 | 24; sampleRate: 44100 | 48000; channels?: 1 | 2 };
  const channels = settings.channels ?? 1;
  if (job.kind !== "wav" || (settings.bitDepth !== 16 && settings.bitDepth !== 24) || (settings.sampleRate !== 44100 && settings.sampleRate !== 48000) || (channels !== 1 && channels !== 2)) throw new Error("Unsupported export settings.");
  // Every export is delivered at the podcast loudness standard: −19 LUFS mono / −16 LUFS stereo, ≤ −1 dBTP.
  const loudness = { targetLufs: channels === 1 ? PODCAST_LOUDNESS.mono : PODCAST_LOUDNESS.stereo, truePeakDb: PODCAST_LOUDNESS.truePeakDb };
  const { doc, epRow, out, clients, clientOf, read } = prepareRender(job);

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

/** Decode a file with ffmpeg to float PCM and measure integrated loudness and true peak (post-encode check). */
function measureFile(path: string, channels: 1 | 2): Promise<{ integratedLufs: number; truePeakDb: number; lra: number }> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-v", "error", "-nostdin", "-i", path, "-f", "f32le", "-ac", String(channels), "-ar", String(DELIVERY_RATE), "-"], { stdio: ["ignore", "pipe", "pipe"] });
    const m = new LoudnessMeter(DELIVERY_RATE, channels);
    const tp = new TruePeakMeter(channels);
    let carry: Buffer = Buffer.alloc(0);
    let err = "";
    p.stdout.on("data", (b: Buffer) => {
      const buf: Buffer = carry.length ? Buffer.concat([carry, b]) : b;
      const frameBytes = 4 * channels;
      const whole = buf.length - (buf.length % frameBytes);
      const n = whole / frameBytes;
      const chs = Array.from({ length: channels }, () => new Float32Array(n));
      for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) chs[c]![i] = buf.readFloatLE((i * channels + c) * 4);
      m.push(chs);
      tp.push(chs);
      carry = buf.subarray(whole);
    });
    p.stderr.on("data", (b: Buffer) => (err = (err + b.toString()).slice(-2000)));
    p.on("error", (e) => reject(e));
    p.on("close", (code) => (code === 0 ? resolve({ integratedLufs: m.integrated(), truePeakDb: tp.db(), lra: m.lra() }) : reject(new Error(err.trim() || `ffmpeg exited with ${code}`))));
  });
}

/**
 * MP3 delivery (Stage 05): render the normalised mix to a temporary 44.1 kHz WAV, encode CBR MP3 with
 * libmp3lame, then decode the MP3 and measure it. If encoding pushed the true peak over the ceiling,
 * render again with more limiter headroom (up to twice). Upload, read back, verify.
 */
async function renderMp3(job: typeof renderJobs.$inferSelect): Promise<void> {
  const settings = job.settings as { preset?: string };
  if (!isDeliveryPreset(settings.preset)) throw new Error("Unsupported MP3 preset.");
  const preset = DELIVERY_PRESETS[settings.preset];
  const channels = preset.channels as 1 | 2;
  const target = loudnessTarget(channels);
  const { doc, epRow, out, clients, clientOf, read } = prepareRender(job);
  const dir = await mkdtemp(join(tmpdir(), "podstudio-mp3-"));
  const wavPath = join(dir, "mix.wav");
  const mp3Path = join(dir, "out.mp3");
  const key = `exports/${job.episodeId}/${job.id}.mp3`;
  const outClient = clientOf(out);
  let uploaded = false;
  let lastBeat = 0;
  const beat = (p: number) => {
    const now = Date.now();
    if (now - lastBeat < 1000 && p < 1) return;
    lastBeat = now;
    const row = db.select({ c: renderJobs.cancelRequested }).from(renderJobs).where(eq(renderJobs.id, job.id)).get();
    if (row?.c) throw new Cancelled();
    db.update(renderJobs).set({ progress: Math.min(0.99, p), leaseUntil: now + LEASE_MS }).where(eq(renderJobs.id, job.id)).run();
  };
  try {
    // Encoding changes the numbers a little (the encoder's low-pass and lossy coding shave off some
    // loudness; overshoots can add true peak). Measure the decoded MP3 and, if it's more than
    // 0.2 LU off target or over the ceiling, render again with the target nudged / more headroom.
    let marginDb = 0.3;
    let lufsOffset = 0;
    let pre: RenderSummary | null = null;
    let post = { integratedLufs: Number.NEGATIVE_INFINITY, truePeakDb: Number.NEGATIVE_INFINITY, lra: 0 };
    let attempts = 0;
    for (; attempts < 3; ) {
      attempts++;
      // 1. the normalised mix → temporary WAV
      const gen = renderWav({ doc, bitDepth: 24, sampleRate: DELIVERY_RATE, channels, loudness: { targetLufs: target.targetLufs + lufsOffset, truePeakDb: target.truePeakDb, marginDb }, read, onProgress: (p) => beat((attempts - 1) / 3 + p * 0.25) });
      const ws = createWriteStream(wavPath);
      for (;;) {
        const n = await gen.next();
        if (n.done) {
          pre = n.value;
          break;
        }
        if (!ws.write(n.value)) await new Promise<void>((r) => ws.once("drain", () => r()));
      }
      await new Promise<void>((r, j) => ws.end((e?: Error | null) => (e ? j(e) : r())));
      // 2. encode: CBR, 44.1 kHz
      await run("ffmpeg", ["-v", "error", "-nostdin", "-y", "-i", wavPath, "-c:a", "libmp3lame", "-b:a", `${preset.kbps}k`, "-ar", String(DELIVERY_RATE), "-ac", String(channels), "-id3v2_version", "3", "-write_xing", "1", mp3Path], { onTick: () => beat((attempts - 1) / 3 + 0.28) });
      // 3. what was actually delivered
      post = await measureFile(mp3Path, channels);
      beat((attempts - 1) / 3 + 0.32);
      if (!Number.isFinite(post.integratedLufs) || pre?.normalise?.capped) break; // silent or capped: nothing to steer
      const lufsErr = target.targetLufs - post.integratedLufs;
      const tpOver = post.truePeakDb - target.truePeakDb;
      if (Math.abs(lufsErr) <= 0.2 && tpOver <= 0.05) break;
      if (Math.abs(lufsErr) > 0.2) lufsOffset += lufsErr;
      if (tpOver > 0.05) marginDb += tpOver + 0.2;
    }
    // 4. upload, read back, verify
    const bytes = (await stat(mp3Path)).size;
    const sent = createHash("sha256");
    const body = Readable.from(
      (async function* () {
        for await (const c of createReadStream(mp3Path, { highWaterMark: 1 << 20 })) {
          sent.update(c as Buffer);
          yield c as Buffer;
        }
      })(),
    );
    uploaded = true;
    await new Upload({ client: outClient, params: { Bucket: out.bucket, Key: key, Body: body, ContentType: "audio/mpeg" }, queueSize: 2, partSize: 8 * 1024 * 1024 }).done();
    const { sha256 } = await readBack(outClient, out.bucket, key, bytes);
    if (sha256 !== sent.digest("hex")) throw new Error("The stored MP3 doesn't match what was encoded (SHA-256 differs).");
    const done = pre!;
    const diagnostics: Diagnostic[] = [...loudnessDiagnostics(done, DELIVERY_RATE)];
    if (Number.isFinite(post.integratedLufs) && Math.abs(post.integratedLufs - target.targetLufs) > 0.5 && !diagnostics.some((d) => d.code === "quiet" || d.code === "silent")) diagnostics.push({ code: "missed-target", message: `After encoding the MP3 measures ${post.integratedLufs.toFixed(1)} LUFS, more than 0.5 LU from ${target.targetLufs}.` });
    if (post.truePeakDb > target.truePeakDb + 0.05) diagnostics.push({ code: "heavy-limiting", message: `After encoding the true peak is ${post.truePeakDb.toFixed(1)} dBTP, over the ${target.truePeakDb} dBTP ceiling, even with extra headroom.` });
    const now = Date.now();
    const assetId = crypto.randomUUID();
    const summary = { frames: done.frames, peak: done.peak, clipped: done.clipped, bytes, sha256, channels, preset: settings.preset, kbps: preset.kbps, integratedLufs: post.integratedLufs, truePeakDb: post.truePeakDb, lra: post.lra, preEncode: { integratedLufs: done.integratedLufs, truePeakDb: done.truePeakDb }, normalise: done.normalise, diagnostics, attempts, marginDb, lufsOffset };
    sqlite.transaction(() => {
      db.insert(assets)
        .values({ id: assetId, showId: epRow.showId, episodeId: job.episodeId, kind: "export_mp3", access: "private", storageTargetId: out.id, key, filename: `episode-r${job.revisionSeq}-${preset.kbps}k-${channels === 2 ? "stereo" : "mono"}-${target.targetLufs}LUFS.mp3`, contentType: "audio/mpeg", bytes, sha256, durationS: Math.round(done.frames / DELIVERY_RATE), sampleRate: DELIVERY_RATE, channels, status: "verified", meta: { revisionSeq: job.revisionSeq, ...summary }, createdAt: now, verifiedAt: now })
        .run();
      db.update(renderJobs).set({ status: "verified", progress: 1, assetId, summary, finishedAt: now, leaseUntil: null, error: null }).where(eq(renderJobs.id, job.id)).run();
    })();
    uploaded = false;
  } catch (e) {
    if (uploaded) await outClient.send(new DeleteObjectCommand({ Bucket: out.bucket, Key: key })).catch(() => {});
    throw e;
  } finally {
    for (const c of clients.values()) c.destroy();
    await rm(dir, { recursive: true, force: true });
  }
}
