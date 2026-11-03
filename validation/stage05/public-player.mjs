// Public players in audiocn's AudioPlayer layout: inline (full), sticky (compact), embed (full).
import { launch, BASE, sleep, ok, failCount, db } from "./lib.mjs";
const { b, ctx, p, errs } = await launch();
await p.setViewportSize({ width: 1440, height: 1000 });
const slug = db(`console.log(d.prepare("select slug from shows limit 1").get().slug)`);
await p.goto(`${BASE}/${slug}`); await sleep(1000);
const pl = p.locator("[data-testid=public-player]").first();
await pl.scrollIntoViewIfNeeded();
ok("inline: audiocn layout (time · seek · remaining, controls, speed, volume)", (await pl.locator("[data-slot=audio-player-time]").count()) === 2 && (await pl.locator("[data-slot=audio-player-seek]").count()) === 1 && (await pl.locator("[data-slot=audio-player-controls]").count()) === 1 && (await pl.locator("[data-testid=player-volume]").count()) === 1);
await p.screenshot({ path: "pp-inline-before.png" });
await pl.locator("[data-testid=public-play]").click(); await sleep(2500);
const t1 = await pl.locator("[data-slot=audio-player-time]").first().innerText();
ok("inline: plays (time moves)", /^0:0[1-9]/.test(t1.trim()), t1);
await pl.locator("[aria-label='Forward 30 seconds']").click(); await sleep(600);
const t2 = await pl.locator("[data-slot=audio-player-time]").first().innerText();
ok("inline: +30 skips", parseInt(t2.split(":")[1]) >= 30, t2);
await pl.locator("[data-slot=audio-player-rate]").click(); await sleep(200);
ok("inline: speed cycles to 1.25×", (await pl.locator("[data-slot=audio-player-rate]").innerText()).includes("1.25"));
await pl.locator("[data-slot=volume-control-mute]").click(); await sleep(200);
ok("inline: mute mutes the shared audio element", await p.evaluate(() => document.querySelector("audio").muted));
await pl.locator("[data-slot=volume-control-mute]").click();
await p.screenshot({ path: "pp-inline-playing.png" });
// sticky bar after scrolling the inline player away
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sleep(800);
const st = p.locator("[data-testid=sticky-player]");
ok("sticky: audiocn compact (play · seek · remaining · speed)", (await st.locator("[data-slot=audio-player-play]").count()) === 1 && (await st.locator("[data-slot=audio-player-seek]").count()) === 1 && (await st.locator("[data-slot=audio-player-time]").count()) === 1);
await p.screenshot({ path: "pp-sticky.png" });
await p.setViewportSize({ width: 390, height: 844 }); await sleep(600);
await p.screenshot({ path: "pp-sticky-phone.png" });
await st.locator("[data-slot=audio-player-play]").click();
// embed
const e = await ctx.newPage(); await e.setViewportSize({ width: 640, height: 260 });
await e.goto(`${BASE}/${slug}/embed/latest`); await sleep(1500);
ok("embed: audiocn layout", (await e.locator("[data-slot=audio-player-controls]").count()) === 1 && (await e.locator("[data-slot=audio-player-time]").count()) === 2);
await e.click("[data-testid=embed-play]"); await sleep(2200);
ok("embed: plays", /^0:0[1-9]/.test((await e.innerText("[data-testid=embed-time]")).trim()));
await e.screenshot({ path: "pp-embed.png" }); await e.close();
console.log("errors", errs); console.log("FAILS", failCount()); await b.close();
