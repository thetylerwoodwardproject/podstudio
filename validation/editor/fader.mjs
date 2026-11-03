import { launch, BASE, sleep, ok, failCount, resetProject, clearImports } from "./lib.mjs";
import fs from "fs";
const epId = fs.readFileSync(new URL("./epid.txt", import.meta.url), "utf8").trim();
const { b, ctx, p, errs } = await launch();
const proj = async () => await (await ctx.request.get(BASE + "/studio/projects/" + epId)).json();
const saved = async () => { await sleep(400); await p.waitForFunction(() => /^Saved/.test(document.querySelector("[data-testid=save-status]").textContent), null, { timeout: 15000 }); };
resetProject(epId); await clearImports(ctx, epId);
await p.goto(BASE + "/studio/editor?episode=" + epId); await p.click("[data-testid=start-editing]"); await p.waitForSelector("[data-testid=canvas-host]"); await sleep(800);
ok("header has a volume fader at 0 dB", (await p.innerText("[data-testid=track-host] [data-testid=track-fader-value]")).startsWith("0.0"));
await p.click("[data-testid=meter-mode-lufs]");
// measure momentary loudness at 0 dB and at −12 dB over the same stretch
// integrated loudness over the same stretch (0 → ~5 s, before the retake tone at 6.7 s) both times: a clean A/B, unlike two momentary readings
const momentaryAt = async () => { await p.keyboard.press("Home"); await p.click("[data-testid=loudness-reset]"); await p.click("[data-testid=play]"); await p.waitForFunction(() => { const t = document.querySelector("[data-testid=clock] span").textContent; const [m, s] = t.split(":"); return +m * 60 + +s >= 5; }, null, { timeout: 20000 }); await p.click("[data-testid=play]"); await sleep(400); return parseFloat((await p.innerText("[data-testid=lufs-integrated]")).replace("−", "-")); };
const a = await momentaryAt();
// keyboard on the header fader: 24 × ArrowDown = −12 dB
await p.locator("[data-testid=track-host] [data-testid=track-fader] input[type=range]").focus();
for (let i = 0; i < 24; i++) await p.keyboard.press("ArrowDown");
await saved();
ok("fader reads −12.0 dB", (await p.innerText("[data-testid=track-host] [data-testid=track-fader-value]")).startsWith("−12.0"));
let d = await proj(); ok("saved as gainDb −12 (24 key presses = one undo step)", d.doc.tracks[0].gainDb === -12, String(d.doc.tracks[0].gainDb));
ok("inspector shows the same", (await p.innerText("[data-testid=inspector-track-fader-value]")).startsWith("−12.0"));
await p.keyboard.press("Home"); await sleep(200); ok("Home with the fader focused leaves it alone (goes to start instead)", (await p.innerText("[data-testid=track-host] [data-testid=track-fader-value]")).startsWith("−12.0") && (await p.innerText("[data-testid=clock]")).startsWith("0:00.0"));
const bq = await momentaryAt();
ok("preview loudness drops 12 LU (integrated, same stretch)", Math.abs((a - bq) - 12) < 0.5, `${a} → ${bq}`);
// double-click resets
await p.locator("[data-testid=track-host] [data-testid=track-fader]").dblclick(); await saved();
d = await proj(); ok("double-click resets to 0 dB", d.doc.tracks[0].gainDb === undefined);
await p.keyboard.press("Control+z"); await saved(); d = await proj();
ok("undo brings −12 back", d.doc.tracks[0].gainDb === -12);
await p.locator("[data-testid=track-host]").screenshot({ path: "fader.png" });
resetProject(epId);
console.log("errors", errs); console.log("FAILS", failCount()); await b.close();
