// New base palette: Brand & theme accents, track colors, embed accents. Read-only on Tyler's data.
import { launch, BASE, sleep, ok, failCount, db } from "./lib.mjs";
const { b, ctx, p, errs } = await launch();
await p.setViewportSize({ width: 1280, height: 900 });
await p.goto(BASE + "/studio/public/brand"); await sleep(1000);
const labels = await p.$$eval("[role=radiogroup][aria-label=Accent] label", (l) => l.map((x) => x.textContent.trim()));
ok("Brand accents: Black, Gold, Cyan, Lime, Coral, Lavender, Custom", JSON.stringify(labels) === JSON.stringify(["Black", "Gold", "Cyan", "Lime", "Coral", "Lavender", "Custom"]), JSON.stringify(labels));
const checked = await p.$eval("[role=radiogroup][aria-label=Accent] input:checked", (i) => i.value);
ok("your saved #BEFF00 reads as the Lime preset", checked === "lime", checked);
await p.screenshot({ path: "palette-brand.png" });
await p.goto(BASE + "/studio/public/embeds"); await sleep(800);
await p.screenshot({ path: "palette-embeds.png" });
const slug = db(`console.log(d.prepare("select slug from shows limit 1").get().slug)`);
for (const a of ["black", "lime", "amber"]) {
  const r = await ctx.request.get(`${BASE}/${slug}/embed/latest?accent=${a}`);
  ok(`embed accent=${a} renders`, r.status() === 200);
}
const e = await ctx.newPage(); await e.setViewportSize({ width: 640, height: 200 });
await e.goto(`${BASE}/${slug}/embed/latest?accent=coral&theme=light`); await sleep(1200); await e.screenshot({ path: "palette-embed-coral-light.png" }); await e.close();
console.log("errors", errs); console.log("FAILS", failCount()); await b.close();
