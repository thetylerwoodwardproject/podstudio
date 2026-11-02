import { launch, BASE, sleep, ok, failCount, resetProject, clearImports } from "./lib.mjs";
import fs from "fs";
const epId = fs.readFileSync(new URL("./epid.txt", import.meta.url), "utf8").trim();
const { b, ctx, p, errs } = await launch();
const R = 48000;
const proj = async () => await (await ctx.request.get(BASE + "/studio/projects/" + epId)).json();
const saved = async () => { await sleep(400); await p.waitForFunction(() => /^Saved/.test(document.querySelector("[data-testid=save-status]").textContent), null, { timeout: 15000 }); };
resetProject(epId); await clearImports(ctx, epId);
await p.goto(BASE + "/studio/editor?episode=" + epId); await p.click("[data-testid=start-editing]"); await p.waitForSelector("[data-testid=canvas-host]"); await sleep(600);
const geo = await p.evaluate(() => { const r = document.querySelector("[data-testid=ruler]"); const box = r.getBoundingClientRect(); const ticks = [...r.children].filter((c) => /^\d+:\d\d$/.test(c.textContent.trim())).slice(0, 2).map((c) => ({ x: parseFloat(c.style.left), s: (([m, s]) => +m * 60 + +s)(c.textContent.trim().split(":")) })); return { left: box.left, pps: (ticks[1].x - ticks[0].x) / (ticks[1].s - ticks[0].s) }; });
const X = (s) => geo.left + s * geo.pps;
const bb = await p.locator("[data-testid=canvas-host]").boundingBox(); const y = bb.y + bb.height * 0.7;
// split at 10 s, then drag the right-hand clip 1.5 s to the left, into the first one
await p.mouse.click(X(10), y); await p.keyboard.press("x"); await saved();
await p.mouse.move(X(13), y); await p.mouse.down(); await p.mouse.move(X(12), y, { steps: 5 }); await p.mouse.move(X(11.5), y, { steps: 5 }); await p.mouse.up(); await saved();
let d = await proj();
const cs = d.doc.clips.sort((a, c) => a.start - c.start);
const ov = (cs[0].start + cs[0].length - cs[1].start) / R;
ok("dragging a clip over its neighbour makes a crossfade (≈1.5 s overlap saved)", Math.abs(ov - 1.5) < 0.1, ov.toFixed(3));
await p.screenshot({ path: "crossfade.png", clip: { x: 0, y: 90, width: 1120, height: 160 } });
// drag it further than the whole first clip: refused, nothing changes
await p.mouse.move(X(9.5), y); await p.mouse.down(); await p.mouse.move(X(5), y, { steps: 5 }); await p.mouse.move(X(-3), y, { steps: 5 }); await p.mouse.up(); await sleep(800);
d = await proj(); const cs2 = d.doc.clips.sort((a, c) => a.start - c.start);
ok("a drag too far stops at the last valid crossfade (never one clip over another)", cs2.length === 2 && cs2[1].start > cs2[0].start && cs2[1].start + cs2[1].length > cs2[0].start + cs2[0].length, cs2.map((c) => (c.start / R).toFixed(2)).join(","));
// playing through the crossfade works
await p.click("[data-testid=play]"); await sleep(2500); await p.click("[data-testid=play]");
// pull it back out: the crossfade disappears
await p.keyboard.press("Control+z"); await saved(); await p.keyboard.press("Control+z"); await saved(); d = await proj();
const cs3 = d.doc.clips.sort((a, c) => a.start - c.start);
ok("undo removes the overlap", cs3[1].start >= cs3[0].start + cs3[0].length);
// keys: Delete = leave gap, Shift+Delete = ripple
const len0 = Math.max(...(await proj()).doc.clips.map((c) => c.start + c.length));
await p.mouse.click(X(5), y); await p.keyboard.press("Delete"); await saved(); d = await proj();
ok("Delete on a clip leaves a gap (length unchanged)", Math.max(...d.doc.clips.map((c) => c.start + c.length)) === len0);
await p.keyboard.press("Control+z"); await saved();
await p.mouse.click(X(5), y); await p.keyboard.press("Shift+Delete"); await saved(); d = await proj();
ok("Shift+Delete ripple deletes (project shorter)", Math.max(...d.doc.clips.map((c) => c.start + c.length)) < len0);
resetProject(epId);
console.log("errors", errs); console.log("FAILS", failCount()); await b.close();
