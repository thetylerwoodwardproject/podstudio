// The non-editor screens moved onto audiocn components: recorder (live waveform + take players),
// studio library (previews), public pages (site player). Read-only except one throwaway take.
import { launch, BASE, sleep, ok, failCount, db } from "./lib.mjs";
import fs from "fs";
const { b, ctx, p, errs } = await launch();
const epId = fs.readFileSync(new URL("./epid.txt", import.meta.url), "utf8").trim();

// ---- recorder
await p.goto(BASE + "/studio/record/solo?episode=" + epId); await p.waitForSelector("[data-testid=solo-stage]");
await p.click("[data-testid=enable-mic]").catch(() => {});
await p.waitForFunction(() => !document.querySelector("[data-testid=record]").disabled, null, { timeout: 20000 });
await p.click("[data-testid=record]"); await p.waitForSelector("[data-testid=rec-pill]");
await sleep(3500); await p.keyboard.press("k"); await sleep(1500);
const wave = await p.evaluate(() => {
  const host = document.querySelector("[aria-label^='Live waveform']");
  const cs = host ? [...host.querySelectorAll("canvas")] : [];
  // some pixels drawn on the audiocn canvas, and the red retake tally on the overlay
  const ink = (c) => { const x = c.getContext("2d"); const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; };
  return { canvases: cs.length, wave: cs[0] ? ink(cs[0]) : 0, tally: cs[1] ? ink(cs[1]) : 0 };
});
ok("recorder: audiocn live waveform draws while recording", wave.canvases >= 2 && wave.wave > 200, JSON.stringify(wave));
ok("recorder: the retake (K) tally shows on the waveform", wave.tally > 10, JSON.stringify(wave));
await p.screenshot({ path: "rec-waveform.png", clip: { x: 0, y: 0, width: 1440, height: 520 } });
await p.click("[data-testid=stop]"); await p.waitForSelector("[data-testid=finished]", { timeout: 60000 });
await sleep(800);
const tp = p.locator("[data-testid=take-player]").first();
ok("recorder: finished take has an audiocn player", (await tp.count()) === 1);
await tp.locator("[data-slot=audio-player-play]").first().click(); await sleep(2000);
const tt = await tp.innerText();
ok("recorder: take plays (time moves)", !/^\s*0:00/.test(tt.trim()), tt.replace(/\n/g, " "));

// ---- studio library (Tyler's existing item: play only)
await p.goto(BASE + "/studio/library"); await p.waitForSelector("[data-testid=lib-list]");
const lp = p.locator("[data-testid=lib-player]").first();
ok("library: items use the audiocn player", (await lp.count()) >= 1);
await lp.locator("[data-testid=lib-play]").click(); await sleep(1800);
const lt = await lp.innerText();
// (navigating away stops it)
ok("library: preview plays (time moves)", !/^\s*0:00\s*$/.test(lt.trim()) && /0:0[1-9]/.test(lt), lt.replace(/\n/g, " "));
await p.screenshot({ path: "library-page.png", clip: { x: 0, y: 0, width: 1440, height: 420 } });

// ---- public show page: latest episode player
const slug = db(`console.log(d.prepare("select slug from shows limit 1").get().slug)`);
await p.goto(BASE + "/" + slug); await sleep(800);
const pp = p.locator(".pp").first();
if (await pp.count()) {
  await pp.locator(".pp-play").click(); await sleep(2500);
  const t1 = await pp.locator(".pp-time").innerText();
  ok("public: inline player plays through the site player (time moves)", /0:0[1-9]|0:[1-5]\d/.test(t1.split("/")[0]), t1);
  await pp.locator("[aria-label='Forward 30 seconds']").click(); await sleep(600);
  const t2 = await pp.locator(".pp-time").innerText();
  ok("public: +30 skips", parseInt(t2.split(":")[1]) >= 30 || /^[1-9]:/.test(t2.trim()), t2);
  await p.screenshot({ path: "public-player.png", clip: { x: 0, y: 300, width: 1440, height: 600 } });
  await pp.locator(".pp-play").click();
} else ok("public: show page has a latest-episode player", false, "no .pp on the page");
console.log("errors", errs); console.log("FAILS", failCount()); await b.close();
