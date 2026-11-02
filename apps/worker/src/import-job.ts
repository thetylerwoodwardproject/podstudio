// Import jobs, Stage 04: an uploaded audio file → the project's format. The original stays
// untouched in private storage; ffprobe checks it really holds audio, ffmpeg decodes it to
// 48 kHz mono 24-bit PCM, and the result is written as a WAV with the same 44-byte header the
// recorder and renderer use, then read back and hashed before the job counts as verified.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, eq } from "drizzle-orm";
import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { assets, db, libraryItems, renderJobs, sqlite, storageTargets } from "@podstudio/db";
import { wavHeaderBytes } from "@podstudio/audio/render";
import { Cancelled, LEASE_MS, clientFor, readBack } from "./storage";

const RATE = 48_000;
const MAX_SECONDS = 8 * 3600;

function run(cmd: string, args: string[], opts: { onTick?: () => void; maxErr?: number } = {}): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (b: Buffer) => out.push(b));
    p.stderr.on("data", (b: Buffer) => (err = (err + b.toString()).slice(-(opts.maxErr ?? 4000))));
    const tick: ReturnType<typeof setInterval> | null = opts.onTick
      ? setInterval(() => {
          try {
            opts.onTick!();
          } catch (e) {
            p.kill("SIGKILL");
            if (tick) clearInterval(tick);
            reject(e);
          }
        }, 1000)
      : null;
    p.on("error", (e) => { if (tick) clearInterval(tick); reject(new Error(`${cmd} couldn't start: ${e.message}`)); });
    p.on("close", (code) => {
      if (tick) clearInterval(tick);
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err });
      else reject(new Error(err.trim().split("\n").slice(-2).join(" ") || `${cmd} exited with ${code}`));
    });
  });
}

export interface DecodeInput {
  originalAssetId: string;
  filename: string;
  showId: string;
  /** null for library items (not tied to one episode). */
  episodeId: string | null;
  /** Object key for the decoded WAV. */
  outKey: string;
  /** Report progress (0–1); throws Cancelled if the user cancelled. */
  beat: (p: number) => void;
}

export interface Decoded {
  assetId: string;
  samples: number;
  label: string;
  codec?: string;
  sourceRate: number | null;
  sourceChannels: number | null;
}

/** Original file → verified 48 kHz mono 24-bit WAV asset. Removes anything it wrote if it fails. */
export async function decodeUpload(input: DecodeInput): Promise<Decoded> {
  const { beat } = input;
  const original = db.select().from(assets).where(and(eq(assets.id, input.originalAssetId), eq(assets.status, "verified"))).get();
  if (!original) throw new Error("The uploaded file is missing.");
  const targets = db.select().from(storageTargets).all();
  const inT = targets.find((t) => t.id === original.storageTargetId);
  const outT = targets.find((t) => (t.routes as string[] | null)?.includes("raw"));
  if (!inT || !outT) throw new Error("No storage target is routed for raw audio.");

  const dir = await mkdtemp(join(tmpdir(), "podstudio-import-"));
  const inClient = clientFor(inT);
  const outClient = clientFor(outT);
  const key = input.outKey;
  let uploaded = false;
  try {
    // 1. fetch the original and check it is the file that was uploaded
    const src = join(dir, "original");
    const obj = await inClient.send(new GetObjectCommand({ Bucket: inT.bucket, Key: original.key }));
    const h = createHash("sha256");
    const body = obj.Body as Readable;
    body.on("data", (b: Buffer) => h.update(b));
    await pipeline(body, createWriteStream(src));
    if (h.digest("hex") !== original.sha256) throw new Error("The stored upload doesn't match its checksum.");
    beat(0.1);

    // 2. is it audio at all?
    const probe = JSON.parse((await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", src])).stdout.toString()) as { streams?: { codec_type?: string; codec_name?: string; sample_rate?: string; channels?: number; duration?: string }[]; format?: { duration?: string; format_name?: string } };
    const audio = probe.streams?.find((s) => s.codec_type === "audio");
    if (!audio) throw new Error("That file doesn't contain an audio track.");
    const dur = Number(audio.duration ?? probe.format?.duration);
    if (Number.isFinite(dur) && dur > MAX_SECONDS) throw new Error("That audio is longer than 8 hours.");
    if (Number.isFinite(dur) && dur < 0.05) throw new Error("That audio is empty.");
    beat(0.15);

    // 3. decode → 48 kHz mono 24-bit little-endian PCM
    const raw = join(dir, "pcm.raw");
    await run("ffmpeg", ["-v", "error", "-nostdin", "-i", src, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", String(RATE), "-f", "s24le", "-acodec", "pcm_s24le", raw], { onTick: () => beat(0.4) });
    const bytes = (await stat(raw)).size;
    if (bytes === 0 || bytes % 3 !== 0) throw new Error("Decoding produced no audio.");
    const samples = bytes / 3;
    if (Number.isFinite(dur) && Math.abs(samples / RATE - dur) > Math.max(2, dur * 0.02)) throw new Error(`Decoded length (${(samples / RATE).toFixed(1)} s) doesn't match the file (${dur.toFixed(1)} s).`);
    beat(0.7);

    // 4. WAV = our 44-byte header + the PCM, stored then read back and hashed
    const sent = createHash("sha256");
    const header = wavHeaderBytes(samples, RATE, 24);
    sent.update(header);
    const stream = Readable.from(
      (async function* () {
        yield Buffer.from(header);
        for await (const c of createReadStream(raw, { highWaterMark: 1 << 20 })) {
          sent.update(c as Buffer);
          yield c as Buffer;
        }
      })(),
    );
    uploaded = true;
    await new Upload({ client: outClient, params: { Bucket: outT.bucket, Key: key, Body: stream, ContentType: "audio/wav" }, queueSize: 2, partSize: 8 * 1024 * 1024 }).done();
    const total = 44 + bytes;
    const { sha256, first } = await readBack(outClient, outT.bucket, key, total);
    if (sha256 !== sent.digest("hex")) throw new Error("The stored audio doesn't match what was decoded (SHA-256 differs).");
    if (first.toString("ascii", 0, 4) !== "RIFF" || first.readUInt32LE(24) !== RATE || first.readUInt16LE(34) !== 24 || first.readUInt32LE(40) !== bytes) throw new Error("The stored WAV header is wrong.");

    const now = Date.now();
    const assetId = crypto.randomUUID();
    const label = input.filename.replace(/\.[^.]+$/, "").slice(0, 120) || "Imported audio";
    db.insert(assets)
      .values({ id: assetId, showId: input.showId, episodeId: input.episodeId, kind: "raw_audio", access: "private", storageTargetId: outT.id, key, filename: `${label}.wav`, contentType: "audio/wav", bytes: total, sha256, durationS: Math.round(samples / RATE), sampleRate: RATE, channels: 1, status: "verified", meta: { bitDepth: 24, samples, importedFrom: { filename: input.filename, originalAssetId: original.id, codec: audio.codec_name, sampleRate: Number(audio.sample_rate) || null, channels: audio.channels ?? null, container: probe.format?.format_name } }, createdAt: now, verifiedAt: now })
      .run();
    uploaded = false;
    return { assetId, samples, label, codec: audio.codec_name, sourceRate: Number(audio.sample_rate) || null, sourceChannels: audio.channels ?? null };
  } catch (e) {
    if (uploaded) await outClient.send(new DeleteObjectCommand({ Bucket: outT.bucket, Key: key })).catch(() => {});
    throw e;
  } finally {
    inClient.destroy();
    outClient.destroy();
    await rm(dir, { recursive: true, force: true });
  }
}

/** A project's upload job (render_jobs kind "import"). */
export async function importJob(job: typeof renderJobs.$inferSelect): Promise<void> {
  const settings = job.settings as { originalAssetId?: string; filename?: string };
  const epRow = sqlite.prepare("select show_id as showId from episodes where id = ?").get(job.episodeId) as { showId: string } | undefined;
  if (!epRow) throw new Error("The episode no longer exists.");
  if (!settings.originalAssetId) throw new Error("The uploaded file is missing.");
  const beat = (p: number) => {
    const row = db.select({ c: renderJobs.cancelRequested }).from(renderJobs).where(eq(renderJobs.id, job.id)).get();
    if (row?.c) throw new Cancelled();
    db.update(renderJobs).set({ progress: p, leaseUntil: Date.now() + LEASE_MS }).where(eq(renderJobs.id, job.id)).run();
  };
  const d = await decodeUpload({ originalAssetId: settings.originalAssetId, filename: settings.filename ?? "Imported audio", showId: epRow.showId, episodeId: job.episodeId, outKey: `imports/${job.episodeId}/${job.id}.wav`, beat });
  const now = Date.now();
  db.update(renderJobs).set({ status: "verified", progress: 1, assetId: d.assetId, summary: { samples: d.samples, durationS: d.samples / RATE, label: d.label, codec: d.codec, sourceRate: d.sourceRate, sourceChannels: d.sourceChannels }, finishedAt: now, leaseUntil: null, error: null }).where(eq(renderJobs.id, job.id)).run();
}

/** A library item's upload job. */
export async function libraryJob(item: typeof libraryItems.$inferSelect): Promise<void> {
  if (!item.originalAssetId) throw new Error("The uploaded file is missing.");
  const beat = (p: number) => {
    const row = db.select({ c: libraryItems.cancelRequested }).from(libraryItems).where(eq(libraryItems.id, item.id)).get();
    if (row?.c) throw new Cancelled();
    db.update(libraryItems).set({ progress: p, leaseUntil: Date.now() + LEASE_MS }).where(eq(libraryItems.id, item.id)).run();
  };
  const d = await decodeUpload({ originalAssetId: item.originalAssetId, filename: item.filename ?? item.name, showId: item.showId, episodeId: null, outKey: `library/${item.showId}/${item.id}.wav`, beat });
  db.update(libraryItems).set({ status: "ready", progress: 1, assetId: d.assetId, durationS: d.samples / RATE, finishedAt: Date.now(), leaseUntil: null, error: null }).where(eq(libraryItems.id, item.id)).run();
}
