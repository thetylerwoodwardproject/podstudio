import { launch, BASE, ok, failCount, sleep } from "../editor/lib.mjs";
const OUT = process.env.OUT || "/tmp";
const { b, ctx, p, errs } = await launch();
await p.goto(BASE + "/studio/social"); await p.waitForSelector("text=Write posts");
ok("posts tab renders", await p.locator('textarea[aria-label="Bluesky post"]').count() === 1);
const counter = await p.locator("text=/\\d+ \\/ 300/").first().textContent();
ok("bluesky counter", /\d+ \/ 300/.test(counter ?? ""), counter);
await p.locator('textarea[aria-label="Bluesky post"]').fill("x".repeat(310));
ok("over-limit flagged", await p.locator('textarea[aria-label="Bluesky post"][aria-invalid=true]').count() === 1);
await p.screenshot({ path: OUT + "/social-posts.png", fullPage: true });
for (const [tab, file] of [["Graphics", "graphics"], ["Carousel", "carousel"], ["Clip captions", "clips"]]) {
  await p.getByRole("tab", { name: tab }).click(); await sleep(400);
  await p.screenshot({ path: `${OUT}/social-${file}.png`, fullPage: true });
}
await p.getByRole("button", { name: "Show voice" }).click(); await sleep(400);
ok("voice sheet opens", await p.locator('textarea[aria-label="Voice"]').count() === 1);
await p.screenshot({ path: OUT + "/social-voice.png" });
await p.keyboard.press("Escape");
await p.setViewportSize({ width: 390, height: 844 }); await p.getByRole("tab", { name: "Posts" }).click(); await sleep(400);
const sw = await p.evaluate(() => document.documentElement.scrollWidth);
ok("no horizontal scroll at 390", sw <= 390, String(sw));
await p.screenshot({ path: OUT + "/social-phone.png", fullPage: true });
ok("no page errors", errs.length === 0, errs.join(" | "));
await b.close(); process.exit(failCount() ? 1 : 0);
