import { launch, BASE, sleep, ok, failCount, resetProject, clearImports } from "./lib.mjs";
import fs from "fs";
const epId = fs.readFileSync(new URL("./epid.txt", import.meta.url), "utf8").trim();
const { b, ctx, p, errs } = await launch();
const R = 48000;
const proj = async () => await (await ctx.request.get(BASE + "/studio/projects/" + epId)).json();
const saved = async () => { await sleep(400); await p.waitForFunction(() => /^Saved/.test(document.querySelector("[data-testid=save-status]").textContent), null, { timeout: 15000 }); };
const len = (d) => Math.max(...d.doc.clips.map((c) => c.start + c.length));
const clockS = async () => { const t = (await p.innerText("[data-testid=clock]")).split("/")[0].trim(); const [m, s] = t.split(":"); return +m * 60 + +s; };

resetProject(epId); await clearImports(ctx, epId);
await p.goto(BASE + "/studio/editor?episode=" + epId); await p.click("[data-testid=start-editing]"); await p.waitForSelector("[data-testid=canvas-host]"); await sleep(600);
await p.click("[data-testid=add-track]"); await p.click("[data-testid=add-track-sfx]"); await saved();
let d0 = await proj();
const host = d0.doc.tracks.find((t) => t.kind === "host").id, sfx = d0.doc.tracks.find((t) => t.kind === "sfx").id;

// px ↔ seconds from the ruler
const geo = await p.evaluate(() => { const r = document.querySelector("[data-testid=ruler]"); const box = r.getBoundingClientRect(); const ticks = [...r.children].filter((c) => /^\d+:\d\d$/.test(c.textContent.trim())).slice(0, 2).map((c) => ({ x: parseFloat(c.style.left), s: (([m, s]) => +m * 60 + +s)(c.textContent.trim().split(":")) })); return { left: box.left, pps: (ticks[1].x - ticks[0].x) / (ticks[1].s - ticks[0].s) }; });
const X = (s) => geo.left + s * geo.pps;
const rowY = async (kind) => { const bb = await p.locator(`[data-testid=canvas-${kind}]`).boundingBox(); return bb.y + bb.height / 2; };
const drag = async (s0, s1, y0, y1 = y0, mods = []) => { for (const m of mods) await p.keyboard.down(m); await p.mouse.move(X(s0), y0); await p.mouse.down(); await p.mouse.move(X((s0 + s1) / 2), (y0 + y1) / 2, { steps: 4 }); await p.mouse.move(X(s1), y1, { steps: 4 }); await p.mouse.up(); for (const m of mods) await p.keyboard.up(m); await sleep(250); };
const range = () => p.evaluate(() => document.querySelector("[data-testid=range-chip]")?.innerText ?? null);

// plain drag on a clip still moves it (no accidental behaviour change)
const hy = await rangeY();
async function rangeY() { return rowY("host"); }
// shift+drag over the host clip → host-only range
await drag(2, 4, hy, hy, ["Shift"]);
ok("Shift+drag over a clip selects a range (chip shows)", /0:02\.\d–0:04\.\d/.test((await range()) ?? ""), await range());
let d = await proj(); ok("…and does not move the clip", JSON.stringify(d.doc.clips) === JSON.stringify(d0.doc.clips));
const lit = async (kind) => p.locator(`[data-testid=canvas-${kind}]`).evaluate((c, x) => { const k = c.getContext("2d"); const r = c.getBoundingClientRect(); const px = Math.round((x - r.left) * devicePixelRatio); const dpx = k.getImageData(px, 2, 1, 1).data; const ref = k.getImageData(Math.round((x - r.left) * devicePixelRatio) + Math.round(300 * devicePixelRatio), 2, 1, 1).data; return dpx.join() !== ref.join(); }, X(3));
ok("highlight drawn on the host track only", (await lit("host")) && !(await lit("sfx")));
await p.screenshot({ path: "range-host.png" });

// range tool: plain drag selects
await p.keyboard.press("Escape"); await p.keyboard.press("r"); await sleep(100);
ok("R turns on the range tool", (await p.getAttribute("[data-testid=range-tool]", "aria-pressed")) === "true");
await drag(6, 8, hy);
d = await proj(); ok("range tool: plain drag selects, clip stays put", /0:06\.\d–0:08\.\d/.test((await range()) ?? "") && JSON.stringify(d.doc.clips) === JSON.stringify(d0.doc.clips), await range());
await p.keyboard.press("r");

// drag across two tracks
const sy = await rowY("sfx");
await drag(10, 12, sy, hy);
ok("dragging from SFX up to Host spans both", /Host|all/.test(await p.locator("[data-testid=range-chip] span").first().getAttribute("title")) && (await p.locator("[data-testid=range-chip] span").first().getAttribute("title")).includes("Sfx"), await p.locator("[data-testid=range-chip] span").first().getAttribute("title"));
// click (no drag) on empty sfx area clears the range and moves the playhead
await p.mouse.click(X(9), sy); await sleep(200);
ok("a click (no drag) clears the range and seeks", (await range()) === null && Math.abs((await clockS()) - 9) < 0.15, String(await clockS()));

// Shift+Delete on a host-only range: gap on host only
await drag(2, 4, hy, hy, ["Shift"]);
const before = len(await proj());
await p.keyboard.press("Delete"); await saved(); d = await proj();
const hostClips = d.doc.clips.filter((c) => c.trackId === host).sort((a, b) => a.start - b.start);
ok("Delete leaves a gap on that track, length unchanged", hostClips.length === 2 && len(d) === before && Math.abs(hostClips[1].start - hostClips[0].length - 2 * R) < 0.1 * R, hostClips.map((c) => [c.start / R, c.length / R].map((v) => v.toFixed(2))).join(" | "));
await p.keyboard.press("Control+z"); await saved();
// Delete (ripple) via the chip's Cut
await drag(2, 4, hy, hy, ["Shift"]);
await p.click("[data-testid=range-cut]"); await saved(); d = await proj();
ok("Cut closes the gap (project ~2 s shorter)", Math.abs(before - len(d) - 2 * R) < 0.1 * R, `${(before / R).toFixed(2)} → ${(len(d) / R).toFixed(2)}`);
ok("selection cleared after the cut", (await range()) === null);
await p.keyboard.press("Control+z"); await saved();

// ---------- loop
await drag(5, 7, hy, hy, ["Shift"]);
await p.keyboard.press("c"); await sleep(200);
ok("C turns the loop on", (await p.getAttribute("[data-testid=loop]", "aria-pressed")) === "true" && (await p.locator("[data-testid=loop-band]").count()) === 1);
await p.screenshot({ path: "loop.png" });
await p.click("[data-testid=play]");
const seen = [];
for (let i = 0; i < 40; i++) { await sleep(150); seen.push(await clockS()); }
const inside = seen.filter((s) => s >= 4.9 && s <= 7.05).length;
const wraps = seen.filter((s, i) => i > 0 && s < seen[i - 1] - 1).length;
ok("playback stays inside 5–7 s", inside === seen.length, seen.join(","));
ok("and wraps around (≥2 times in 6 s)", wraps >= 2, `wraps ${wraps}`);
await p.click("[data-testid=play]"); await sleep(200);
await p.keyboard.press("c"); await sleep(100);
await p.click("[data-testid=play]"); await sleep(3000);
const after = await clockS();
ok("loop off: playback runs past the old loop end", after > 7.2, String(after));
await p.click("[data-testid=play]");
await p.keyboard.press("Escape"); await sleep(100);
ok("Esc clears the selection", (await range()) === null);
ok("loop button can't stay on without a selection", (await p.getAttribute("[data-testid=loop]", "aria-pressed")) === "false");

resetProject(epId);
console.log("errors", errs); console.log("FAILS", failCount()); await b.close();
