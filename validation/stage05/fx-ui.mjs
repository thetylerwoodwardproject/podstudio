// Stage 05 demo path: FX on a voice track (Simple popover + Advanced inspector), then MP3 exports measured with ffmpeg.
import { launch, BASE, sleep, ok, failCount, resetProject, clearImports } from "./lib.mjs";
import fs from "fs";
import { execSync } from "child_process";
const epId = fs.readFileSync(new URL("./epid.txt", import.meta.url), "utf8").trim();
const { b, ctx, p, errs } = await launch();
const proj = async () => await (await ctx.request.get(BASE + "/studio/projects/" + epId)).json();
const saved = async () => { await sleep(500); await p.waitForFunction(() => /^Saved/.test(document.querySelector("[data-testid=save-status]").textContent), null, { timeout: 20000 }); };
resetProject(epId); await clearImports(ctx, epId);
await p.goto(BASE + "/studio/episodes"); await p.evaluate(() => { localStorage.setItem("podstudio.editor.advanced", "0"); localStorage.removeItem("podstudio.editor.inspector"); });
await p.goto(BASE + "/studio/editor?episode=" + epId); await p.click("[data-testid=start-editing]"); await p.waitForSelector("[data-testid=canvas-host]"); await sleep(800);

// ---- Simple: FX popover from the track header
ok("FX button off at first", (await p.getAttribute("[data-testid=track-host] [data-testid=track-fx-button]", "aria-pressed")) === "false");
await p.click("[data-testid=track-host] [data-testid=track-fx-button]");
await p.waitForSelector("[data-testid=fx-popover] [data-testid=fx-panel]");
ok("FX popover opens with the panel (filters, EQ, noise, compressor, volume, curve)", (await p.locator("[data-testid=fx-popover] [data-testid=fx-eq-curve]").count()) === 1 && (await p.locator("[data-testid=fx-popover] [data-testid=fx-comp]").count()) === 1);
await p.click("[data-testid=fx-popover] [data-testid=fx-hpf-on]"); await sleep(150);
await p.click("[data-testid=fx-popover] [data-testid=fx-nr-on]"); await sleep(150);
await p.click("[data-testid=fx-popover] [data-testid=fx-comp-on]"); await sleep(150);
// mid EQ gain by keyboard on the audiocn knob
const dial = p.locator("[data-testid=fx-popover] [data-testid=fx-eq-mid-gain] [role=slider]").first();
await dial.focus();
for (let i = 0; i < 6; i++) await p.keyboard.press("ArrowUp");
await saved();
let d = await proj();
let fx = d.doc.tracks.find((t) => t.kind === "host").fx;
ok("FX saved: high-pass, noise reduction, compressor on; mid EQ boosted", fx?.hpf.on && fx?.nr.on && fx?.comp.on && fx?.eq.mid.gainDb > 0, JSON.stringify(fx && { hpf: fx.hpf, nr: fx.nr, comp: fx.comp, mid: fx.eq.mid }));
ok("mid gain readout formatted like '+x.x dB'", /^\+\d+\.\d dB$/.test((await p.innerText("[data-testid=fx-popover] [data-testid=fx-eq-mid-gain-value]")).trim()), await p.innerText("[data-testid=fx-popover] [data-testid=fx-eq-mid-gain-value]"));
const curve = await p.locator("[data-testid=fx-popover] [data-testid=fx-eq-curve] path").getAttribute("d");
ok("EQ curve reflects the high-pass (low end pulled down)", (() => { const ys = curve.match(/[ML]\d+,([\d.]+)/g).map((m) => +m.split(",")[1]); return ys[0] > ys[150] + 5; })());
await p.screenshot({ path: "fx-popover.png" });
await p.keyboard.press("Escape"); await sleep(200);
ok("FX button is lit", (await p.getAttribute("[data-testid=track-host] [data-testid=track-fx-button]", "aria-pressed")) === "true");
// play through the FX worklet: no errors, the clock runs
await p.keyboard.press("Home"); await p.click("[data-testid=play]"); await sleep(2500);
const clock = await p.innerText("[data-testid=clock] span");
await p.click("[data-testid=play]");
ok("plays through the FX (clock advances, no errors)", clock !== "0:00.0" && errs.length === 0, clock + " " + errs.join(" | "));
// undo: the knob turn was one step
await p.evaluate(() => document.activeElement?.blur());
await p.keyboard.press("Control+z"); await saved(); d = await proj();
fx = d.doc.tracks.find((t) => t.kind === "host").fx;
ok("one undo takes the whole knob turn back", fx?.eq.mid.gainDb === 0, String(fx?.eq.mid.gainDb));
await p.keyboard.press("Control+Shift+z"); await saved();

// ---- Advanced: the inspector's FX and LUFS tabs
await p.click("[data-testid=advanced-toggle]"); await sleep(300);
await p.click("[data-testid=track-host] [data-testid=track-fx-button]"); await sleep(300);
ok("Advanced: FX button opens the inspector's FX tab", (await p.getAttribute("[data-testid=tab-fx]", "data-state")) === "active" && (await p.locator("[data-testid=inspector] [data-testid=fx-panel]").count()) === 1);
await p.screenshot({ path: "fx-inspector.png" });
await p.click("[data-testid=tab-loud]"); await sleep(200);
ok("LUFS tab shows the LCD readout", (await p.locator("[data-testid=loudness-tab] [data-testid=lcd-integrated]").count()) === 1);
await p.evaluate(() => localStorage.setItem("podstudio.editor.advanced", "0"));

// ---- MP3 exports, measured independently
const exportMp3 = async (preset) => {
  await p.click("[data-testid=open-export]"); await p.waitForSelector("[data-testid=export-dialog]");
  await p.click("[data-testid=fmt-mp3]"); await p.click(`[data-testid=preset-${preset}]`);
  const before = await p.locator("[data-testid=export-job]").count();
  await p.click("[data-testid=start-export]");
  await p.waitForFunction((n) => document.querySelectorAll("[data-testid=export-job]").length > n && document.querySelector("[data-testid=export-job]").dataset.status === "verified", before, { timeout: 300000 });
  const row = p.locator("[data-testid=export-job]").first();
  const label = await row.locator("[data-testid=export-label]").innerText();
  const href = await row.locator("[data-testid=export-download]").getAttribute("href");
  const f = `fx-${preset}.mp3`;
  fs.writeFileSync(f, Buffer.from(await (await ctx.request.get(BASE + href)).body()));
  const probe = JSON.parse(execSync(`ffprobe -v error -show_streams -show_format -of json ${f}`).toString());
  const s = probe.streams[0];
  const r = execSync(`ffmpeg -hide_banner -nostats -i ${f} -af ebur128=peak=true -f null - 2>&1 | sed -n '/Summary/,$p'`).toString();
  const I = +r.match(/I:\s+(-?[\d.]+) LUFS/)[1], TP = +r.match(/Peak:\s+(-?[\d.]+) dBFS/)[1];
  const diag = await row.locator("[data-testid=export-diagnostics]").count();
  await p.click("[aria-label='Close export']");
  return { label, codec: s.codec_name, rate: +s.sample_rate, ch: s.channels, kbps: Math.round(+s.bit_rate / 1000), I, TP, diag };
};
const st = await exportMp3("mp3-128-stereo");
console.log("128 stereo:", JSON.stringify(st));
ok("MP3 128 stereo: mp3, 44.1 kHz, 2 ch, 128 kbps CBR", st.codec === "mp3" && st.rate === 44100 && st.ch === 2 && st.kbps === 128);
ok("MP3 128 stereo measures −16 LUFS ±0.5 (ffmpeg, after encoding)", Math.abs(st.I + 16) <= 0.5, String(st.I));
ok("MP3 128 stereo true peak ≤ −1 dBTP (ffmpeg, after encoding)", st.TP <= -1.0, String(st.TP));
const mo = await exportMp3("mp3-64-mono");
console.log("64 mono:", JSON.stringify(mo));
ok("MP3 64 mono: 1 ch, 64 kbps", mo.ch === 1 && mo.kbps === 64);
ok("MP3 64 mono measures −19 LUFS ±0.5", Math.abs(mo.I + 19) <= 0.5, String(mo.I));
ok("MP3 64 mono true peak ≤ −1 dBTP", mo.TP <= -1.0, String(mo.TP));
for (const id of await p.$$eval("[data-testid=export-job] [data-testid=export-download]", (a) => a.map((x) => x.getAttribute("href").split("/").pop()))) await ctx.request.delete(BASE + "/studio/exports/" + id);
resetProject(epId);
console.log("errors", errs); console.log("FAILS", failCount()); await b.close();
