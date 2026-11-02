// Creates a synthetic 2-hour, 48 kHz mono, 24-bit "recording" (speech-like bursts with pauses and a
// retake tone every ~10 minutes) directly in the raw storage target, plus its episode/recording/
// asset rows, so the editor can be measured at the 2-hour scale without recording for two hours.
// Run inside the web container:  docker compose exec -T web node - < validation/editor/make-2h.mjs
// Prints the episode id. Remove everything again by deleting that episode in the studio.
const Database = require("better-sqlite3");
const { S3Client, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { Readable } = require("node:stream");
const nc = require("node:crypto");
const d = new Database("/data/podstudio.db");
const HOURS = Number(process.env.HOURS || 2);
const R = 48000, total = HOURS * 3600 * R;
const show = d.prepare("select id from shows limit 1").get();
const target = d.prepare("select * from storage_targets").all().find((t) => JSON.parse(t.routes || "[]").includes("raw"));
const epId = nc.randomUUID(), recId = nc.randomUUID(), assetId = nc.randomUUID();
const now = Date.now();
d.prepare("insert into episodes (id, show_id, title, status, visibility, guid, public_id, slug, explicit, created_at, updated_at) values (?,?,?,?,?,?,?,?,0,?,?)")
  .run(epId, show.id, `${HOURS}-hour editor measurement (delete me)`, "recording", "private", nc.randomUUID(), nc.randomUUID(), `${HOURS}h-measurement`, now, now);
const key = `recordings/${recId}/${assetId}.wav`;
const header = Buffer.alloc(44);
header.write("RIFF", 0); header.writeUInt32LE(36 + total * 3, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
header.writeUInt32LE(R, 24); header.writeUInt32LE(R * 3, 28); header.writeUInt16LE(3, 32); header.writeUInt16LE(24, 34); header.write("data", 36); header.writeUInt32LE(total * 3, 40);
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
// burst schedule: 1.5–6 s of "speech", 0.5–2 s pause
const bursts = []; for (let t = 1; t < HOURS * 3600; ) { const len = 1.5 + rnd() * 4.5; bursts.push([t, t + len]); t += len + 0.5 + rnd() * 1.5; }
const tones = []; for (let t = 600; t < HOURS * 3600; t += 600) tones.push(Math.round(t * R));
async function* gen() {
  yield header;
  let bi = 0, sh = 0;
  for (let s0 = 0; s0 < total; s0 += R) {
    const n = Math.min(R, total - s0), buf = Buffer.alloc(n * 3);
    const sec = s0 / R; while (bi < bursts.length && bursts[bi][1] < sec) bi++;
    for (let i = 0; i < n; i++) {
      const t = (s0 + i) / R; let v = 0.0006 * (rnd() * 2 - 1);
      const b = bursts[bi]; if (b && t >= b[0] && t < b[1]) { const env = (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)) * Math.min(1, (t - b[0]) / 0.03, (b[1] - t) / 0.05); v += 0.18 * env * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 360 * t) + 0.3 * Math.sin(2 * Math.PI * 900 * t)); }
      for (const ts of tones) if (s0 + i >= ts && s0 + i < ts + 12000) v += 0.5 * Math.sin((2 * Math.PI * 1000 * (s0 + i - ts)) / R);
      const q = Math.max(-8388608, Math.min(8388607, Math.round(v * 8388608))); const o = i * 3; buf[o] = q & 255; buf[o + 1] = (q >> 8) & 255; buf[o + 2] = (q >> 16) & 255;
    }
    yield buf;
  }
}
(async () => {
  const c = new S3Client({ endpoint: target.endpoint, region: target.region || "us-east-1", forcePathStyle: true, credentials: { accessKeyId: target.access_key_id, secretAccessKey: target.secret_access_key } });
  const hash = nc.createHash("sha256");
  const src = Readable.from(gen()); src.on("data", (b) => hash.update(b));
  const t0 = Date.now();
  await new Upload({ client: c, params: { Bucket: target.bucket, Key: key, Body: src }, queueSize: 2, partSize: 16 * 1024 * 1024 }).done();
  const head = await c.send(new HeadObjectCommand({ Bucket: target.bucket, Key: key }));
  const bytes = 44 + total * 3;
  if (head.ContentLength !== bytes) throw new Error("size mismatch " + head.ContentLength);
  d.prepare("insert into assets (id, show_id, episode_id, kind, access, storage_target_id, key, filename, content_type, bytes, sha256, duration_s, sample_rate, channels, status, meta, created_at, verified_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(assetId, show.id, epId, "raw_audio", "private", target.id, key, "synthetic.wav", "audio/wav", bytes, hash.digest("hex"), Math.round(total / R), R, 1, "verified", JSON.stringify({ bitDepth: 24, samples: total }), now, now);
  d.prepare("insert into recordings (id, show_id, episode_id, status, sample_rate, channels, bit_depth, annotations, total_samples, final_asset_id, started_at, ended_at, finalized_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(recId, show.id, epId, "complete", R, 1, 24, JSON.stringify(tones.map((s) => ({ type: "retake", sample: s, atS: s / R }))), total, assetId, now, now, now);
  console.log(JSON.stringify({ epId, recId, assetId, bytes, seconds: (Date.now() - t0) / 1000, tones: tones.length }));
  c.destroy();
})().catch((e) => { console.error(e); process.exit(1); });
