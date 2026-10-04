import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rm, stat, rename } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "./context.ts";
import type { EditorProjectV1 } from "../src/lib/editor-project.ts";
import { audioConfiguration } from "../src/lib/episode-package.ts";
import { parseWav } from "../src/lib/audio/wav-read.ts";
import { HttpError, json, readJson, streamToFile } from "./http.ts";
import { recordingId } from "./recordings.ts";

export interface AudioAsset {
  id: string;
  user_id: number;
  episode_id: string;
  take_id: string;
  revision: number;
  fingerprint: string;
  bytes: number;
  duration: number;
  state: string;
  manifest: string;
}
export interface AiAudioChunk {
  start: number;
  end: number;
  bytes: number;
}
export const UPLOAD_CHUNK = 8 << 20;
export class PreparedAudio {
  private ctx: Context;
  private completing = new Map<string, Promise<void>>();
  constructor(ctx: Context) {
    this.ctx = ctx;
  }
  dir(id: string) {
    if (!recordingId(id)) throw new HttpError(404, "Not found");
    return join(this.ctx.config.data, "prepared", id);
  }
  get(id: string, user: number) {
    const asset = this.ctx.db
      .prepare("SELECT * FROM prepared_audio WHERE id = ? AND user_id = ?")
      .get(id, user) as unknown as AudioAsset | undefined;
    if (!asset || asset.state === "deleted")
      throw new HttpError(
        404,
        "Prepared audio is unavailable. Open the editor to prepare it again.",
      );
    return asset;
  }
  current(asset: AudioAsset) {
    const row = this.ctx.db
      .prepare("SELECT value FROM editor_projects WHERE take_id = ?")
      .get(asset.take_id) as { value: string } | undefined;
    return (
      !!row &&
      createHash("sha256")
        .update(audioConfiguration(JSON.parse(row.value)))
        .digest("hex") === asset.fingerprint
    );
  }
  private async complete(asset: AudioAsset) {
    const dir = this.dir(asset.id);
    if (asset.state !== "uploading" || !this.current(asset))
      throw new HttpError(409, "The mix changed. Prepare the current version.");
    const temp = join(dir, "master.wav.part");
    await rm(temp, { force: true });
    for (let n = 0; n < Math.ceil(asset.bytes / UPLOAD_CHUNK); n++) {
      const chunk = join(dir, `chunk-${n}`);
      const size = await stat(chunk).catch(() => null);
      if (
        !size ||
        size.size !== Math.min(UPLOAD_CHUNK, asset.bytes - n * UPLOAD_CHUNK)
      )
        throw new HttpError(
          409,
          "Some upload chunks are missing. Retry preparation.",
        );
      await pipeline(
        createReadStream(chunk),
        createWriteStream(temp, { flags: n ? "a" : "w" }),
      );
    }
    const file = await open(temp, "r");
    const head = Buffer.alloc(8192);
    let count = 0;
    try {
      count = (await file.read(head, 0, head.length, 0)).bytesRead;
    } finally {
      await file.close();
    }
    const info = parseWav(new DataView(head.buffer, head.byteOffset, count));
    if (
      !info ||
      info.format !== "pcm" ||
      ![1, 2].includes(info.channels) ||
      ![16, 24].includes(info.bitDepth) ||
      info.sampleRate !== 48000 ||
      info.dataOffset + info.dataBytes !== asset.bytes
    )
      throw new HttpError(
        400,
        "Prepared audio must be a complete PCM WAV at 48 kHz.",
      );
    const duration =
      info.dataBytes / ((info.bitDepth / 8) * info.channels * info.sampleRate);
    if (!(duration > 0)) throw new HttpError(400, "The finished mix is empty");
    if (this.ctx.recordings.deleted(asset.take_id))
      throw new HttpError(410, "The recording was deleted");
    await rename(temp, join(dir, "master.wav"));
    this.ctx.db
      .prepare("UPDATE prepared_audio SET state = ?, duration = ? WHERE id = ?")
      .run("ready", duration, asset.id);
    for (let n = 0; n < Math.ceil(asset.bytes / UPLOAD_CHUNK); n++)
      await rm(join(dir, `chunk-${n}`), { force: true });
  }
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    p: string[],
    user: number,
  ) {
    if (p[0] !== "prepared-audio") return false;
    if (p.length === 1 && req.method === "POST") {
      const b = await readJson<{
        takeId: string;
        episodeId: string;
        revision: number;
        fingerprint: string;
        bytes: number;
      }>(req);
      const row = this.ctx.db
        .prepare(
          "SELECT value, revision, episode_id FROM editor_projects WHERE take_id = ?",
        )
        .get(b.takeId) as
        { value: string; revision: number; episode_id: string } | undefined;
      if (!row || row.episode_id !== b.episodeId)
        throw new HttpError(
          404,
          "Save this editor project before preparing an episode.",
        );
      const project = JSON.parse(row.value) as EditorProjectV1;
      if (
        row.revision !== b.revision ||
        createHash("sha256")
          .update(audioConfiguration(project))
          .digest("hex") !== b.fingerprint
      )
        throw new HttpError(
          409,
          "The mix changed. Save it and prepare the latest version.",
        );
      if (
        project.tracks.some(
          (t) => t.kind === "voice" && (t.role ?? "host") === "host",
        ) &&
        project.retakes.some((r) => !r.reviewed)
      )
        throw new HttpError(
          409,
          "Review the retakes before preparing the finished episode.",
        );
      if (
        !Number.isSafeInteger(b.bytes) ||
        b.bytes < 44 ||
        b.bytes > 0xffffffff
      )
        throw new HttpError(413, "The prepared WAV must be under 4 GB.");
      const previous = this.ctx.db
        .prepare(
          "SELECT * FROM prepared_audio WHERE user_id = ? AND take_id = ? AND fingerprint = ? AND state IN (?, ?) ORDER BY created_at DESC LIMIT 1",
        )
        .get(user, b.takeId, b.fingerprint, "uploading", "ready") as unknown as
        AudioAsset | undefined;
      if (previous) {
        json(res, 200, previous);
        return true;
      }
      const id = randomUUID();
      await mkdir(this.dir(id), { recursive: true });
      this.ctx.db
        .prepare(
          "INSERT INTO prepared_audio(id, user_id, episode_id, take_id, revision, fingerprint, bytes, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          user,
          b.episodeId,
          b.takeId,
          b.revision,
          b.fingerprint,
          b.bytes,
          "uploading",
          Date.now(),
        );
      json(res, 201, this.get(id, user));
      return true;
    }
    const asset = this.get(p[1], user),
      dir = this.dir(asset.id);
    if (p[2] === "chunks" && p.length === 4 && req.method === "PUT") {
      const n = Number(p[3]);
      if (asset.state !== "uploading")
        throw new HttpError(409, "This prepared audio is already complete.");
      if (
        !Number.isInteger(n) ||
        n < 0 ||
        n >= Math.ceil(asset.bytes / UPLOAD_CHUNK)
      )
        throw new HttpError(400, "Invalid upload chunk");
      const expected = Math.min(UPLOAD_CHUNK, asset.bytes - n * UPLOAD_CHUNK);
      const file = join(dir, `chunk-${n}`);
      const size = await streamToFile(req, file, expected);
      if (size !== expected) {
        await rm(file, { force: true });
        throw new HttpError(400, "Incomplete upload chunk. Retry it.");
      }
      if (this.ctx.recordings.deleted(asset.take_id)) {
        await rm(dir, { force: true, recursive: true });
        throw new HttpError(410, "The recording was deleted");
      }
      json(res, 200, { chunk: n });
      return true;
    }
    if (p[2] === "complete" && req.method === "POST") {
      if (asset.state === "ready") {
        json(res, 200, asset);
        return true;
      }
      let pending = this.completing.get(asset.id);
      if (!pending) {
        pending = this.complete(asset);
        this.completing.set(asset.id, pending);
      }
      try {
        await pending;
      } finally {
        if (this.completing.get(asset.id) === pending)
          this.completing.delete(asset.id);
      }
      json(res, 200, this.get(asset.id, user));
      return true;
    }
    if (p[2] === "ai" && p.length === 4 && req.method === "PUT") {
      const n = Number(p[3]);
      if (
        asset.state !== "ready" ||
        !Number.isInteger(n) ||
        n < 0 ||
        n > Math.ceil(asset.duration / 600)
      )
        throw new HttpError(400, "Invalid transcription chunk");
      const size = await streamToFile(req, join(dir, `ai-${n}.mp3`), 20 << 20);
      json(res, 200, { bytes: size });
      return true;
    }
    if (p[2] === "ai-manifest" && req.method === "PUT") {
      const { chunks } = await readJson<{ chunks: AiAudioChunk[] }>(
        req,
        64 << 10,
      );
      if (
        asset.state !== "ready" ||
        !Array.isArray(chunks) ||
        !chunks.length ||
        chunks.length > 1000
      )
        throw new HttpError(400, "Invalid transcription chunks");
      for (let n = 0; n < chunks.length; n++) {
        const c = chunks[n];
        if (
          !Number.isFinite(c.start) ||
          !Number.isFinite(c.end) ||
          c.start !== Math.max(0, n * 600 - (n ? 2 : 0)) ||
          c.end !== Math.min(asset.duration, (n + 1) * 600) ||
          c.end <= c.start ||
          c.bytes > 20 << 20
        )
          throw new HttpError(
            400,
            "Transcription chunk timing does not match the mix",
          );
        if ((await stat(join(dir, `ai-${n}.mp3`))).size !== c.bytes)
          throw new HttpError(409, "A transcription chunk is incomplete");
      }
      if (chunks.at(-1)!.end !== asset.duration)
        throw new HttpError(
          400,
          "Transcription must include the entire finished mix",
        );
      this.ctx.db
        .prepare("UPDATE prepared_audio SET manifest = ? WHERE id = ?")
        .run(JSON.stringify(chunks), asset.id);
      json(res, 200, {});
      return true;
    }
    if (p[2] === "wav" && (req.method === "GET" || req.method === "HEAD")) {
      if (asset.state !== "ready")
        throw new HttpError(409, "Audio preparation is not finished");
      const file = join(dir, "master.wav");
      const size = (await stat(file)).size;
      let start = 0,
        end = size - 1;
      const range = req.headers.range;
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!m || (!m[1] && !m[2]))
          throw new HttpError(416, "Invalid audio range");
        start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
        end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          start >= size
        )
          throw new HttpError(416, "Invalid audio range");
        res.statusCode = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      } else res.statusCode = 200;
      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", end - start + 1);
      res.setHeader("Cache-Control", "private, no-store");
      if (req.method === "HEAD") res.end();
      else createReadStream(file, { start, end }).pipe(res);
      return true;
    }
    if (p.length === 2 && req.method === "GET") {
      json(res, 200, { ...asset, current: this.current(asset) });
      return true;
    }
    throw new HttpError(404, "Not found");
  }
}
