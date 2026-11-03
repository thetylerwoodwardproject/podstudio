import { spawn } from "node:child_process";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { db, storageTargets } from "@podstudio/db";
import { clientFor, findPublicAudio, openAudio } from "~/lib/media.server";
import { reducePeaks } from "~/lib/waveform-peaks";

// Server-only. The public player's waveform: the published MP3 decoded once (ffmpeg, mono 8 kHz),
// reduced to BARS peak levels (0..1, scaled to the loudest), and cached as JSON beside the MP3 on
// the same storage target. Public episodes only (findPublicAudio), so nothing private leaks.

export const WAVEFORM_BARS = 1000;
const RATE = 8000;
const cacheKey = (key: string) => `${key}.wave1.json`;
const inflight = new Map<string, Promise<EpisodeWaveform | null>>();

export interface EpisodeWaveform {
  v: 1;
  /** Seconds, as decoded. */
  duration: number;
  /** WAVEFORM_BARS levels, 0..1. */
  peaks: number[];
}

export function episodeWaveform(slug: string, publicId: string): Promise<EpisodeWaveform | null> {
  const audio = findPublicAudio(slug, publicId);
  if (!audio) return Promise.resolve(null);
  const id = `${audio.targetId}:${audio.key}`;
  let p = inflight.get(id);
  if (!p) {
    p = build(audio).finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

async function build(audio: NonNullable<ReturnType<typeof findPublicAudio>>): Promise<EpisodeWaveform | null> {
  const target = db.select().from(storageTargets).where(eq(storageTargets.id, audio.targetId)).get();
  if (!target) return null;
  const client = clientFor(target);
  try {
    try {
      const hit = await client.send(new GetObjectCommand({ Bucket: target.bucket, Key: cacheKey(audio.key) }));
      const cached = JSON.parse(await hit.Body!.transformToString()) as EpisodeWaveform;
      if (cached?.v === 1 && Array.isArray(cached.peaks) && cached.peaks.length === WAVEFORM_BARS) return cached;
    } catch {
      // not cached yet
    }
    const body = await openAudio(audio, null);
    if (!body) return null;
    const decoded = await decodePeaks(body);
    if (!decoded) return null;
    const wave: EpisodeWaveform = { v: 1, duration: decoded.samples / RATE, peaks: reducePeaks(decoded.blocks, WAVEFORM_BARS) };
    await client.send(new PutObjectCommand({ Bucket: target.bucket, Key: cacheKey(audio.key), Body: JSON.stringify(wave), ContentType: "application/json" }));
    return wave;
  } finally {
    client.destroy();
  }
}

/** Stream the MP3 through ffmpeg; keep one absolute peak per 50 ms block (never the whole PCM). */
function decodePeaks(input: NodeJS.ReadableStream): Promise<{ blocks: Float32Array; samples: number } | null> {
  return new Promise((resolve) => {
    const ff = spawn("ffmpeg", ["-v", "error", "-i", "pipe:0", "-ac", "1", "-ar", String(RATE), "-f", "s16le", "pipe:1"], { stdio: ["pipe", "pipe", "ignore"] });
    const BLOCK = RATE / 20;
    let blocks = new Float32Array(1 << 14);
    let n = 0;
    let inBlock = 0;
    let peak = 0;
    let samples = 0;
    let carry: Buffer | null = null;
    ff.stdout.on("data", (chunk: Buffer) => {
      const buf: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk;
      const whole = buf.length - (buf.length % 2);
      for (let i = 0; i < whole; i += 2) {
        const v = Math.abs(buf.readInt16LE(i)) / 32768;
        if (v > peak) peak = v;
        if (++inBlock === BLOCK) {
          if (n === blocks.length) {
            const grown = new Float32Array(blocks.length * 2);
            grown.set(blocks);
            blocks = grown;
          }
          blocks[n++] = peak;
          peak = 0;
          inBlock = 0;
        }
      }
      samples += whole / 2;
      carry = whole < buf.length ? buf.subarray(whole) : null;
    });
    ff.on("error", () => resolve(null));
    ff.on("close", (code) => {
      if (inBlock > 0) {
        if (n === blocks.length) {
          const grown = new Float32Array(blocks.length + 1);
          grown.set(blocks);
          blocks = grown;
        }
        blocks[n++] = peak;
      }
      resolve(code === 0 && samples > 0 ? { blocks: blocks.subarray(0, n), samples } : null);
    });
    ff.stdin.on("error", () => {});
    input.on("error", () => ff.kill());
    input.pipe(ff.stdin);
  });
}
