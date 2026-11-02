const Database = require("better-sqlite3");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const d = new Database("/data/podstudio.db");
const EP = process.env.EP;
const exp = d.prepare("select a.* from assets a where a.kind='export_wav' and a.episode_id=?").get(EP);
const raw = d.prepare("select a.* from assets a where a.kind='raw_audio' and a.episode_id=?").get(EP);
const t = d.prepare("select * from storage_targets where id=?").get(exp.storage_target_id);
const c = new S3Client({ endpoint: t.endpoint, region: t.region || "us-east-1", forcePathStyle: true, credentials: { accessKeyId: t.access_key_id, secretAccessKey: t.secret_access_key }, responseChecksumValidation: "WHEN_REQUIRED" });
const rd = async (a, from, n) => { const r = await c.send(new GetObjectCommand({ Bucket: t.bucket, Key: a.key, Range: `bytes=${44 + from * 3}-${44 + (from + n) * 3 - 1}` })); const b = Buffer.from(await r.Body.transformToByteArray()); const f = new Float64Array(n); for (let i = 0, o = 0; i < n; i++, o += 3) { let v = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); if (v & 0x800000) v |= ~0xffffff; f[i] = v / 8388608; } return f; };
(async () => {
  const R = 48000, scale = 8 * 10 ** (-18 / 20);
  let worst = -999;
  for (const sec of [3, 600 - 0.5, 1800.25, 3600 + 7, 5400, 7190]) {
    const from = Math.round(sec * R), n = R;
    const [a, b] = [await rd(exp, from, n), await rd(raw, from, n)];
    let s = 0, p = 0; for (let i = 0; i < n; i++) { s += (a[i] - b[i] * scale) ** 2; p += (b[i] * scale) ** 2; }
    const res = 10 * Math.log10(s / n + 1e-20), sig = 10 * Math.log10(p / n + 1e-20);
    worst = Math.max(worst, res);
    console.log(`t=${sec}s signal ${sig.toFixed(1)} dBFS residual ${res.toFixed(1)} dBFS`);
  }
  console.log("worst residual", worst.toFixed(1), "dBFS", worst < -60 ? "PASS (< −60)" : "FAIL");
  c.destroy();
})();
