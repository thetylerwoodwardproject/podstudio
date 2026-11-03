// No Advanced switch; right panel tabs (Library default); bigger FX knobs; podcast presets; per-track ducking in FX.
import { launch, BASE, sleep, ok, failCount, resetProject, clearImports } from "./lib.mjs";
import fs from "fs";
const epId = fs.readFileSync(new URL("./epid.txt", import.meta.url), "utf8").trim();
const { b, ctx, p, errs } = await launch();
await p.setViewportSize({ width: 1280, height: 800 });
const proj = async () => await (await ctx.request.get(BASE + "/studio/projects/" + epId)).json();
const saved = async () => { await sleep(500); await p.waitForFunction(() => /^Saved/.test(document.querySelector("[data-testid=save-status]")?.textContent ?? ""), null, { timeout: 20000 }); };
resetProject(epId); await clearImports(ctx, epId);
await p.goto(BASE + "/studio/episodes"); await p.evaluate(() => localStorage.removeItem("podstudio.editor.inspector"));
await p.goto(BASE + "/studio/editor?episode=" + epId); await p.click("[data-testid=start-editing]"); await p.waitForSelector("[data-testid=canvas-host]"); await sleep(900);

ok("no Advanced switch", (await p.locator("[data-testid=advanced-toggle]").count()) === 0);
const tabs = await p.$$eval("[data-testid=inspector] [role=tab]", (t) => t.map((x) => x.textContent.trim()));
ok("right panel tabs: Library · Clip · Marks · LUFS (no Duck)", JSON.stringify(tabs.map((t) => t.replace(/\d+$/, ""))) === JSON.stringify(["Library", "Clip", "Marks", "LUFS"]), JSON.stringify(tabs));
ok("Library tab open by default with the show's items", (await p.getAttribute("[data-testid=tab-library]", "data-state")) === "active" && (await p.locator("[data-testid=library-sidebar-item]").count()) >= 1);
ok("Range tool always in the toolbar", (await p.locator("[data-testid=range-tool]").count()) === 1);
ok("track header has a fader and a level meter", (await p.locator("[data-testid=track-host] [data-testid=track-fader]").count()) === 1 && (await p.locator("[data-testid=track-host] [data-testid=track-meter]").count()) === 1);
ok("transport master meter present", (await p.locator("[data-testid=transport-meter]").count()) === 1);
await p.screenshot({ path: "r7-editor.png" });

// FX: bigger knobs, presets
const btn = "[data-testid=track-host] [data-testid=track-fx-button]";
await p.click(btn); await p.waitForSelector("[data-testid=fx-popover] [data-testid=fx-panel]");
await p.click("[data-testid=fx-popover] [data-testid=fx-tab-nr]"); await sleep(150);
const kn = await p.$eval("[data-testid=fx-popover] [data-testid=fx-nr-amount] [data-slot=knob-dial], [data-testid=fx-popover] [data-testid=fx-nr-amount] [role=slider]", (e) => e.getBoundingClientRect().width);
ok("single-control knobs are large (≥ 60 px)", kn >= 60, String(kn));
await p.click("[data-testid=fx-popover] [data-testid=fx-tab-eq]"); await sleep(150);
const ek = await p.$eval("[data-testid=fx-popover] [data-testid=fx-eq-mid-gain] [role=slider]", (e) => e.getBoundingClientRect().width);
ok("EQ knobs bigger than before (≥ 44 px)", ek >= 44, String(ek));
await p.screenshot({ path: "r7-fx-eq.png" });
await p.click("[data-testid=fx-popover] [data-testid=fx-presets]"); await sleep(250);
const names = await p.$$eval("[data-testid^=fx-builtin-]", (e) => e.map((x) => x.querySelector("span")?.textContent));
ok("built-in podcast presets listed", names.length >= 6, JSON.stringify(names));
await p.screenshot({ path: "r7-presets.png" });
await p.click("[data-testid=fx-builtin-voice-clean]"); await saved();
let fx = (await proj()).doc.tracks[0].fx;
ok("'Podcast voice' applies HPF 80, mud cut, presence, 35 % comp", fx.hpf.on && fx.hpf.freq === 80 && fx.eq.low.gainDb === -2 && fx.eq.mid.gainDb === 2 && fx.comp.on && fx.comp.amount === 0.35, JSON.stringify(fx));

// ducking per track (on the host track itself there's nothing to trigger it; add a music track first via the library)
await p.keyboard.press("Escape"); await sleep(200);
await p.locator("[data-testid=library-sidebar-item] [data-testid=library-sidebar-add]").first().click({ force: true }); await saved();
const d1 = await proj();
const music = d1.doc.tracks.find((t) => t.kind !== "host");
ok("library + adds a track", !!music, JSON.stringify(d1.doc.tracks.map((t) => t.kind)));
const mBtn = p.locator(`[data-track-id="${music.id}"] [data-testid=track-fx-button], [data-testid=track-header]:has-text("${music.name}") [data-testid=track-fx-button]`).first();
await mBtn.click(); await p.waitForSelector("[data-testid=fx-popover] [data-testid=fx-chain]");
await p.click("[data-testid=fx-popover] [data-testid=fx-duck-on]"); await saved();
const d2 = await proj();
const rule = d2.doc.ducking?.find((r) => r.targets.includes(music.id));
ok("Ducking switch in the FX list adds a rule for just that track under the voices", !!rule && rule.enabled && rule.targets.length === 1 && rule.triggers === "speech", JSON.stringify(d2.doc.ducking));
ok("Ducking pane shows its controls", (await p.locator("[data-testid=fx-popover] [data-testid=fx-duck]").count()) === 1);
await p.screenshot({ path: "r7-fx-duck.png" });
await p.keyboard.press("Escape"); await sleep(200);
ok("FX button lit for the ducked track", (await mBtn.getAttribute("aria-pressed")) === "true" || (await mBtn.getAttribute("data-pressed")) !== null);
await mBtn.click(); await p.waitForSelector("[data-testid=fx-popover] [data-testid=fx-chain]");
await p.click("[data-testid=fx-popover] [data-testid=fx-duck-on]"); await saved();
const d3 = await proj();
ok("switching Ducking off disables the rule", d3.doc.ducking?.find((r) => r.targets.includes(music.id))?.enabled === false);
await p.keyboard.press("Escape");
resetProject(epId);
console.log("errors", errs); console.log("FAILS", failCount()); await b.close();
