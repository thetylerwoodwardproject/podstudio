// The transport's master meter has separate L and R bars and both move during playback (one editor, no Advanced mode).
import { launch, BASE, sleep, ok, failCount, resetProject, clearImports } from "./lib.mjs";
import fs from "fs";
const epId = fs.readFileSync(new URL("./epid.txt", import.meta.url), "utf8").trim();
const { b, ctx, p, errs } = await launch();
resetProject(epId); await clearImports(ctx, epId);
await p.goto(BASE + "/studio/episodes"); await p.evaluate(() => localStorage.setItem("podstudio.editor.meter", "dbfs"));
await p.goto(BASE + "/studio/editor?episode=" + epId); await p.click("[data-testid=start-editing]"); await p.waitForSelector("[data-testid=canvas-host]"); await sleep(800);
const lvl = (sel) => p.$$eval(sel, (els) => els.map((e) => parseFloat(getComputedStyle(e.closest("[data-slot=level-meter-channel]") ?? e).getPropertyValue("--meter-level") || "0")));
ok("transport meter has L and R bars", (await p.locator("[data-testid=transport-left]").count()) === 1 && (await p.locator("[data-testid=transport-right]").count()) === 1);
await p.click("[data-testid=play]");
const seen = [];
for (let i = 0; i < 8; i++) { await sleep(250); seen.push([...(await lvl("[data-testid=transport-left]")), ...(await lvl("[data-testid=transport-right]"))]); }
await p.screenshot({ path: "lr-transport.png", clip: { x: 0, y: 830, width: 1440, height: 70 } });
await p.click("[data-testid=play]");
ok("both bars move while playing", seen.some(([l, r]) => l > 0.2 && r > 0.2), JSON.stringify(seen.map((x) => x.map((v) => v.toFixed(2)))));
ok("a mono mix reads the same on L and R", seen.every(([l, r]) => Math.abs(l - r) < 0.02));
resetProject(epId);
console.log("errors", errs); console.log("FAILS", failCount()); await b.close();
