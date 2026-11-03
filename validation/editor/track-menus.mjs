import { launch, BASE, sleep, ok, failCount, resetProject, clearImports } from "./lib.mjs";
import fs from "fs";
const epId = fs.readFileSync(new URL("./epid.txt", import.meta.url), "utf8").trim();
const M = new URL("./media/", import.meta.url).pathname;
const { b, ctx, p, errs } = await launch();
const proj = async () => await (await ctx.request.get(BASE + "/studio/projects/" + epId)).json();
const saved = async () => { await sleep(400); await p.waitForFunction(() => /^Saved/.test(document.querySelector("[data-testid=save-status]").textContent), null, { timeout: 15000 }); };
const items = async () => (await (await ctx.request.get(BASE + "/studio/library/items")).json()).items;
resetProject(epId);
for (const i of await items()) if (i.name === "ZZ test bed (delete me)") await ctx.request.delete(BASE + "/studio/library/items/" + i.id);
const before = (await items()).map((i) => i.id);

// a test library item of our own (Tyler's existing items are left alone)
let r = await ctx.request.put(BASE + "/studio/library/items", { headers: { "X-Filename": "music.flac", "X-Name": encodeURIComponent("ZZ test bed (delete me)"), "X-Kind": "music" }, data: fs.readFileSync(M + "music.flac") });
const mine = (await r.json()).item?.id ?? (await items()).find((i) => !before.includes(i.id))?.id;
for (let i = 0; i < 60 && (await items()).find((x) => x.id === mine)?.status !== "ready"; i++) await sleep(1000);
ok("test library item ready", (await items()).find((x) => x.id === mine)?.status === "ready");

resetProject(epId); await clearImports(ctx, epId);
await p.goto(BASE + "/studio/editor?episode=" + epId); await p.click("[data-testid=start-editing]"); await p.waitForSelector("[data-testid=canvas-host]"); await sleep(600);
await p.evaluate(() => localStorage.removeItem("podstudio.editor.inspector"));

// ---------- add track menu
await p.click("[data-testid=add-track]");
await p.waitForSelector("[data-testid=add-track-menu]");
ok("add-track menu shows the four kinds", (await p.locator("[data-testid^=add-track-]:is([data-testid=add-track-host],[data-testid=add-track-guest],[data-testid=add-track-music],[data-testid=add-track-sfx])").count()) === 4);
await p.waitForSelector("[data-testid=add-track-library-item]");
const libRows = await p.locator("[data-testid=add-track-library-item]").allInnerTexts();
ok("add-track menu lists the library", libRows.some((t) => t.includes("ZZ test bed")), libRows.join(" | "));
const box = await p.locator("[data-testid=add-track-menu]").boundingBox();
ok("menu is fully on screen (not clipped by the timeline)", box && box.y >= 0 && box.y + box.height <= 900 && box.x + box.width <= 1440, JSON.stringify(box));
await p.screenshot({ path: "add-track-menu.png" });
await p.locator("[data-testid=add-track-library-item]").filter({ hasText: "ZZ test bed" }).locator("[data-testid=add-track-library-add]").click();
await saved();
let d = await proj();
const bedTrack = d.doc.tracks.find((t) => t.kind === "music");
ok("library pick made a new music track with its clip", !!bedTrack && d.doc.clips.some((c) => c.trackId === bedTrack.id), d.doc.tracks.map((t) => t.name).join(","));
ok("menu closed after picking", (await p.locator("[data-testid=add-track-menu]").count()) === 0);
await p.click("[data-testid=add-track]"); await p.click("[data-testid=add-track-sfx]"); await saved();
d = await proj(); ok("empty SFX track still works", d.doc.tracks.some((t) => t.kind === "sfx"));
await p.click("[data-testid=add-track]"); await p.keyboard.press("Escape"); await sleep(150);
ok("Escape closes the menu", (await p.locator("[data-testid=add-track-menu]").count()) === 0);

// ---------- track colour
const musicRow = p.locator("[data-testid=track-music]");
await musicRow.locator("[data-testid=track-menu-button]").click();
await p.waitForSelector("[data-testid=track-menu]");
await p.click("[data-testid=track-color-5b8def]"); await saved();
d = await proj();
ok("picking a swatch sets the colour", d.doc.tracks.find((t) => t.kind === "music").color === "#5b8def");
const bar = await musicRow.locator("[data-testid=track-color-bar]").evaluate((e) => getComputedStyle(e).backgroundColor);
ok("header colour bar follows", bar === "rgb(91, 141, 239)", bar);
const px = await musicRow.locator("canvas").evaluate((c) => { const x = c.getContext("2d"); const w = c.width, h = c.height; const data = x.getImageData(0, 0, Math.min(w, 600), h).data; let n = 0; for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - 91) < 6 && Math.abs(data[i + 1] - 141) < 6 && Math.abs(data[i + 2] - 239) < 6) n++; return n; });
ok("waveform is drawn in the new colour", px > 50, `${px} px`);
await p.screenshot({ path: "track-menu.png" });
await p.click("[data-testid=track-color-default]"); await saved();
d = await proj(); ok("Default removes the custom colour", !("color" in d.doc.tracks.find((t) => t.kind === "music")));
await p.keyboard.press("Escape");
await p.keyboard.press("Control+z"); await saved(); d = await proj();
ok("colour change is undoable", d.doc.tracks.find((t) => t.kind === "music").color === "#5b8def");
// right-click opens the same menu
await musicRow.locator("[data-testid=track-header]").click({ button: "right", position: { x: 120, y: 60 } }); await sleep(200);
ok("right-click on a track header opens the context menu", (await p.locator("[data-testid=track-context-menu]").count()) === 1);
await p.click("[data-testid=ctx-track-colour]"); await sleep(250);
ok("…and Colour… opens the colour popover", (await p.locator("[data-testid=track-menu]").count()) === 1);
await p.keyboard.press("Escape"); await sleep(100);

// ---------- delete
await p.locator("[data-testid=track-sfx] [data-testid=track-menu-button]").click();
await p.click("[data-testid=track-delete]"); await saved();
d = await proj(); ok("empty track deletes without a confirm", !d.doc.tracks.some((t) => t.kind === "sfx"));
await musicRow.locator("[data-testid=track-menu-button]").click(); await p.click("[data-testid=track-delete]");
ok("track with clips asks first", (await p.locator("[data-testid=track-delete-confirm]").count()) === 1, await p.locator("[data-testid=track-delete-confirm]").innerText().catch(() => ""));
await p.click("[data-testid=track-delete-yes]"); await saved();
d = await proj(); ok("confirmed delete removes the track and its clips", !d.doc.tracks.some((t) => t.kind === "music") && d.doc.clips.every((c) => d.doc.tracks.some((t) => t.id === c.trackId)));
ok("toast mentions undo", /Ctrl\+Z/.test(await p.locator("[data-testid=toast]").innerText().catch(() => "")));
await p.keyboard.press("Control+z"); await saved(); d = await proj();
ok("undo brings the track and clip back", d.doc.tracks.some((t) => t.kind === "music") && d.doc.clips.some((c) => c.trackId === d.doc.tracks.find((t) => t.kind === "music").id));
// last track cannot be deleted: delete music, then try host
await musicRow.locator("[data-testid=track-menu-button]").click(); await p.click("[data-testid=track-delete]"); await p.click("[data-testid=track-delete-yes]"); await saved();
await p.locator("[data-testid=track-host] [data-testid=track-menu-button]").click(); await p.click("[data-testid=track-delete]"); await p.click("[data-testid=track-delete-yes]").catch(() => {}); await sleep(400);
ok("the last track is refused", (await proj()).doc.tracks.length === 1 && /at least one track/.test(await p.locator("[data-testid=toast]").innerText().catch(() => "")));
await p.keyboard.press("Escape");
await p.keyboard.press("Control+z"); await saved();

// ---------- inspector collapse
const tlW = async () => (await p.locator("[data-testid=timeline-scroll]").boundingBox()).width;
const w0 = await tlW();
await p.click("[data-testid=inspector-collapse]"); await sleep(300);
const w1 = await tlW();
ok("collapsing gives the timeline ~276 px more", w1 - w0 > 260, `${w0} → ${w1}`);
ok("rail shows", (await p.locator("[data-testid=inspector-rail]").count()) === 1);
await p.screenshot({ path: "collapsed.png" });
await p.reload(); await p.waitForSelector("[data-testid=canvas-host]"); await sleep(500);
ok("collapsed state survives a reload", (await p.locator("[data-testid=inspector-rail]").count()) === 1);
await p.click("[data-testid=inspector-rail-duck]"); await sleep(200);
ok("rail icon reopens on that tab", (await p.locator("[data-testid=ducking-panel]").count()) === 1);
await p.evaluate(() => document.activeElement?.blur());
await p.keyboard.press("i"); await sleep(200); ok("I collapses", (await p.locator("[data-testid=inspector-rail]").count()) === 1);
await p.keyboard.press("i"); await sleep(200); ok("I expands", (await p.locator("[data-testid=inspector]").count()) === 1);

// ---------- layout: transport at the bottom, title readable when narrow
const tb = await p.locator("[data-testid=transport]").boundingBox();
ok("transport bar sits at the bottom of the window", Math.abs(tb.y + tb.height - 900) < 2, JSON.stringify(tb));
ok("play button is in the bottom bar", (await p.locator("[data-testid=transport] [data-testid=play]").count()) === 1);
for (const w of [1024, 1280]) {
  await p.setViewportSize({ width: w, height: 760 }); await sleep(300);
  const t = await p.locator("[data-testid=editor-title]").evaluate((e) => ({ full: e.scrollWidth <= e.clientWidth + 1, w: e.clientWidth }));
  ok(`title not crushed at ${w}px (≥150px wide)`, t.w >= 150, JSON.stringify(t));
  const over = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  ok(`no horizontal page scroll at ${w}px`, !over);
  await p.screenshot({ path: `narrow-${w}.png` });
}
await p.setViewportSize({ width: 1440, height: 900 }); await sleep(300);
await p.click("[data-testid=shortcuts]"); await sleep(200);
ok("shortcuts popover opens", (await p.locator('[role=dialog][aria-label="Keyboard shortcuts"]').count()) === 1);
await p.keyboard.press("Escape");

// ---------- ducking styling still functional
await p.click('[data-testid=tab-duck]');
await p.click("[data-testid=add-duck-rule]"); await saved();
await p.waitForSelector("[data-testid=duck-envelope]");
const pathBefore = await p.locator("[data-testid=duck-envelope] path").nth(1).getAttribute("d");
await p.locator("[data-testid=duck-amount]").fill("-30"); await saved();
const pathAfter = await p.locator("[data-testid=duck-envelope] path").nth(1).getAttribute("d");
ok("envelope redraws with the amount", pathBefore !== pathAfter);
d = await proj(); ok("amount saved", d.doc.ducking[0].amountDb === -30);
await p.click("[data-testid=duck-trigger-picked]"); await saved();
const host = d.doc.tracks.find((t) => t.kind === "host");
d = await proj(); ok("pick-tracks preselects host", Array.isArray(d.doc.ducking[0].triggers) && d.doc.ducking[0].triggers.includes(host.id));
await p.locator(`[data-testid=duck-trigger-${host.id}]`).click(); await saved();
ok("warning when nothing triggers", (await p.locator("[data-testid=duck-triggers]").innerText()).includes("Pick at least one"));
await p.locator(`[data-testid=duck-trigger-${host.id}]`).click(); await saved();
await p.click("[data-testid=duck-enabled]"); await saved(); d = await proj();
ok("switch turns the rule off", d.doc.ducking[0].enabled === false);
await p.click("[data-testid=duck-enabled]"); await saved();
await p.locator("[data-testid=ducking-panel]").screenshot({ path: "ducking.png" });
await p.screenshot({ path: "editor-full.png" });

// cleanup
await p.evaluate(() => localStorage.removeItem("podstudio.editor.inspector"));
resetProject(epId);
r = await ctx.request.delete(BASE + "/studio/library/items/" + mine);
ok("test library item deleted", r.ok() && !(await items()).some((i) => i.id === mine));
console.log("errors", errs); console.log("FAILS", failCount()); await b.close();
