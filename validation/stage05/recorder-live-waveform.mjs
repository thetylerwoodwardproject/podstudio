// The recorder's live waveform must scroll left from the right edge (newest on the right), not grow out of the center.
import { launch, BASE, sleep, ok, failCount } from "./lib.mjs";
import fs from "fs";
const epId = fs.readFileSync(new URL("./epid.txt", import.meta.url), "utf8").trim();
const { b, p, errs } = await launch();
await p.setViewportSize({ width: 1440, height: 900 });
await p.goto(BASE + "/studio/record/solo?episode=" + epId); await p.waitForSelector("[data-testid=solo-stage]");
await p.click("[data-testid=enable-mic]").catch(() => {});
await p.waitForFunction(() => !document.querySelector("[data-testid=record]").disabled, null, { timeout: 20000 });
await p.click("[data-testid=record]"); await p.waitForSelector("[data-testid=rec-pill]");
const extent = () => p.evaluate(() => {
  const c = document.querySelector("[aria-label^='Live waveform'] canvas");
  const x = c.getContext("2d"); const { width: w, height: h } = c; const d = x.getImageData(0, 0, w, h).data;
  // columns holding a real bar (taller than the 1 px empty-history line)
  let min = w, max = -1;
  for (let col = 0; col < w; col++) {
    let n = 0;
    for (let row = 0; row < h; row++) if (d[(row * w + col) * 4 + 3] > 0) n++;
    if (n > 6) { if (col < min) min = col; if (col > max) max = col; }
  }
  const dpr = window.devicePixelRatio || 1;
  return { w: w / dpr, min: min / dpr, max: max / dpr };
});
await sleep(4000);
const a = await extent();
await p.screenshot({ path: "livewave-4s.png", clip: { x: 0, y: 600, width: 1100, height: 300 } });
await sleep(4000);
const b2 = await extent();
await p.screenshot({ path: "livewave-8s.png", clip: { x: 0, y: 600, width: 1100, height: 300 } });
console.log(JSON.stringify({ a, b2 }));
// minBarHeight draws a 1 px line across empty history; so look at where the *tall* bars start
ok("after 4 s: audio reaches the right edge (allowing for a pause in speech)", a.max >= a.w - 30, JSON.stringify(a));
ok("after 4 s: audio only fills the rightmost ~160 px (not spreading from the center)", a.min >= a.w - 220, JSON.stringify(a));
ok("after 8 s: audio has scrolled further left", b2.min < a.min - 40 && b2.max >= b2.w - 8, JSON.stringify(b2));
await p.click("[data-testid=stop]"); await p.waitForSelector("[data-testid=finished]", { timeout: 60000 });
console.log("errors", errs); console.log("FAILS", failCount()); await b.close();
