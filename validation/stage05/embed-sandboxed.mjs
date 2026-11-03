import { launch, BASE, sleep, ok, failCount, db } from "./lib.mjs";
const { b, ctx, p, errs } = await launch();
const slug = db(`console.log(d.prepare("select slug from shows limit 1").get().slug)`);
for (const [name, sb] of [["sandboxed", ' sandbox="allow-scripts allow-popups"'], ["plain", ""]]) {
  await p.route(BASE + "/__h", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><body style="background:#eee"><iframe id=f${sb} src="/${slug}/embed/all?accent=lime" style="border:0;width:640px;height:400px"></iframe></body>` }));
  await p.goto(BASE + "/__h"); await sleep(2500);
  const fr = p.frameLocator("#f");
  await fr.locator("[data-testid=embed-play]").click(); await sleep(2500);
  const t = await fr.locator("[data-testid=embed-time]").innerText();
  ok(`${name} iframe: embed plays (time moves)`, /^0:0[1-9]|^0:[1-5]\d/.test(t.trim()), t);
  await p.screenshot({ path: `embed-${name}.png` });
  await p.unroute(BASE + "/__h");
}
console.log("errors", errs); console.log("FAILS", failCount()); await b.close();
