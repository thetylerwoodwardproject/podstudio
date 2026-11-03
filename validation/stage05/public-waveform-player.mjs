// Redesigned public player: audiocn Waveform as the seek bar (inline, sticky, embed).
import { launch, BASE, sleep, ok, failCount, db } from "./lib.mjs";
const { b, ctx, p, errs } = await launch();
const slug = db(`console.log(d.prepare("select slug from shows limit 1").get().slug)`);
const pid = db(`console.log(d.prepare("select e.public_id from episodes e join shows s on s.id=e.show_id where s.slug=? and e.status='published' and e.visibility='public' and e.audio_asset_id is not null order by e.publish_at desc limit 1").get("${slug}").public_id)`);
const t0 = Date.now();
const r = await ctx.request.get(`${BASE}/${slug}/media/${pid}/waveform.json`);
const j = r.ok() ? await r.json() : null;
ok("waveform.json: 1000 peaks in 0..1 with the loudest at 1", !!j && j.peaks.length === 1000 && Math.max(...j.peaks) === 1 && Math.min(...j.peaks) >= 0, `${r.status()} ${Date.now() - t0} ms, duration ${j?.duration}`);
const r2 = await ctx.request.get(`${BASE}/${slug}/media/${pid}/waveform.json`); const t1 = Date.now(); await r2.body();
ok("waveform.json is cached (second request fast)", Date.now() - t1 < 1500);
const nope = await ctx.request.get(`${BASE}/${slug}/media/nope/waveform.json`);
ok("unknown / non-public episode: 404", nope.status() === 404);

for (const [w, h] of [[1440, 1000], [390, 844]]) {
  await p.setViewportSize({ width: w, height: h });
  await p.goto(`${BASE}/${slug}`); await sleep(1500);
  const pl = p.locator("[data-testid=public-player]").first(); await pl.scrollIntoViewIfNeeded(); await sleep(400);
  const wf = pl.locator("[data-testid=player-waveform]");
  ok(`${w}: inline player shows the episode waveform`, (await wf.count()) === 1);
  const ink = await wf.locator("canvas").evaluate((c) => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  ok(`${w}: waveform drawn`, ink > 500, String(ink));
  await p.screenshot({ path: `wp-inline-${w}.png` });
}
await p.setViewportSize({ width: 1440, height: 1000 }); await p.goto(`${BASE}/${slug}`); await sleep(1500);
const pl = p.locator("[data-testid=public-player]").first(); await pl.scrollIntoViewIfNeeded();
const wf = pl.locator("[data-testid=player-waveform]"); const box = await wf.boundingBox();
await p.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2); await sleep(2500);
const dur = j.duration;
const at = await p.evaluate(() => document.querySelector("audio").currentTime);
ok("clicking 75% along the waveform starts playback there", Math.abs(at - dur * 0.75) < 4, `${at.toFixed(1)} of ${dur.toFixed(1)}`);
await p.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2); await sleep(300);
await p.screenshot({ path: "wp-inline-playing.png" });
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sleep(800);
ok("sticky bar uses the waveform too", (await p.locator("[data-testid=sticky-player] [data-testid=player-waveform]").count()) === 1);
await p.screenshot({ path: "wp-sticky.png" });
await p.locator("[data-testid=sticky-player] [data-slot=audio-player-play]").click();
const e = await ctx.newPage(); await e.setViewportSize({ width: 640, height: 280 });
await e.goto(`${BASE}/${slug}/embed/latest`); await sleep(2000);
ok("embed uses the waveform", (await e.locator("[data-testid=player-waveform]").count()) === 1);
await e.click("[data-testid=embed-play]"); await sleep(2000);
ok("embed plays", /^0:0[1-9]/.test((await e.innerText("[data-testid=embed-time]")).trim()));
await e.screenshot({ path: "wp-embed.png" }); await e.close();
console.log("errors", errs); console.log("FAILS", failCount()); await b.close();
