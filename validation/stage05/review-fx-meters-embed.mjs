// This round: FX strip (wide + short, same popover in Simple and Advanced), FX button accent states,
// stock audiocn meters, audiocn embed (single + playlist), library dialog preview.
import { launch, BASE, sleep, ok, failCount, resetProject, clearImports, db } from "./lib.mjs";
import fs from "fs";
const epId = fs.readFileSync(new URL("./epid.txt", import.meta.url), "utf8").trim();
const { b, ctx, p, errs } = await launch();
await p.setViewportSize({ width: 1280, height: 800 }); // laptop
resetProject(epId); await clearImports(ctx, epId);
await p.goto(BASE + "/studio/episodes"); await p.evaluate(() => { localStorage.setItem("podstudio.editor.advanced", "0"); });
await p.goto(BASE + "/studio/editor?episode=" + epId); await p.click("[data-testid=start-editing]"); await p.waitForSelector("[data-testid=canvas-host]"); await sleep(800);
const btn = "[data-testid=track-host] [data-testid=track-fx-button]";
const bg = (sel) => p.$eval(sel, (e) => getComputedStyle(e).backgroundColor);
const primary = await p.evaluate(() => { const d = document.createElement("div"); d.style.background = "var(--primary)"; document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; });

for (const mode of ["simple", "advanced"]) {
  if (mode === "advanced") { await p.click("[data-testid=advanced-toggle]"); await sleep(400); }
  await p.click(btn); await p.waitForSelector("[data-testid=fx-popover] [data-testid=fx-panel]"); await sleep(300);
  const box = await p.locator("[data-testid=fx-popover]").boundingBox();
  ok(`${mode}: FX opens as a popover from the button`, !!box);
  ok(`${mode}: FX popover is compact (fits a 1280×800 laptop)`, box.height <= 300 && box.width <= 720 && box.x + box.width <= 1280, JSON.stringify(box));
  // Hindenburg-style: one effect's controls at a time
  for (const t of ["nr", "hpf", "lpf", "eq", "comp", "volume"]) {
    await p.click(`[data-testid=fx-popover] [data-testid=fx-tab-${t}]`); await sleep(120);
    ok(`${mode}: clicking ${t} shows only its controls`, (await p.locator(`[data-testid=fx-popover] [data-testid=fx-pane-${t}]`).count()) === 1 && (await p.locator("[data-testid=fx-popover] [role=tabpanel]").count()) === 1);
    if (mode === "simple") await p.screenshot({ path: `r6-fx-pane-${t}.png` });
  }
  const open = await p.getAttribute(btn, "data-open");
  ok(`${mode}: button outlined in the accent while its panel is open`, open === "" && (await p.$eval(btn, (e) => getComputedStyle(e).borderColor)) === primary);
  if (mode === "simple") {
    await p.click("[data-testid=fx-popover] [data-testid=fx-hpf-on]"); await sleep(200);
    const sw = await bg("[data-testid=fx-popover] [data-testid=fx-hpf-on]");
    ok("switch on = accent color", sw === primary, sw);
  }
  await p.screenshot({ path: `r6-fx-${mode}.png` });
  await p.keyboard.press("Escape"); await sleep(300);
  ok(`${mode}: FX button filled with the same accent as the panel's switches`, (await bg(btn)) === primary, await bg(btn));
}
ok("Advanced inspector no longer has an FX tab", (await p.locator("[data-testid=tab-fx]").count()) === 0);

// meters: stock audiocn look (solid, no segment mask), readout + clip light
await p.keyboard.press("Home"); await p.click("[data-testid=play]"); await sleep(2500);
const m = await p.evaluate(() => ({
  variants: [...document.querySelectorAll("[data-slot=level-meter]")].map((e) => e.dataset.variant),
  masterValue: document.querySelector("[data-testid=master-meter] [data-slot=db-readout]")?.textContent,
  clip: !!document.querySelector("[data-testid=master-meter] [data-slot=clip-indicator]"),
  scale: !!document.querySelector("[data-testid=master-meter] [data-slot=db-scale]"),
}));
ok("all meters are audiocn solid (stock look)", m.variants.length >= 2 && m.variants.every((v) => v === "solid"), JSON.stringify(m.variants));
ok("master: dB scale, live readout and clip light", m.scale && m.clip && /\d/.test(m.masterValue ?? ""), JSON.stringify(m));
await p.screenshot({ path: "r6-meters-advanced.png" });
await p.click("[data-testid=meter-mode-lufs]"); await sleep(1200); await p.screenshot({ path: "r6-meters-advanced-lufs.png" });
await p.click("[data-testid=meter-mode-dbfs]");
await p.click("[data-testid=advanced-toggle]"); await sleep(1500);
await p.screenshot({ path: "r6-meters-simple.png" });
const tv = await p.innerText("[data-testid=transport-meter-value]");
ok("transport meter shows a live dB readout", /\d/.test(tv), tv);
await p.click("[data-testid=transport-meter-block]"); await sleep(800);
ok("clicking the transport meter switches to LUFS", (await p.getAttribute("[data-testid=transport-meter]", "data-mode")) === "lufs");
await p.screenshot({ path: "r6-meters-simple-lufs.png" });
await p.click("[data-testid=transport-meter-block]");
await p.click("[data-testid=play]");
resetProject(epId);

// embed: single + playlist, through a host page that listens for the messages
const slug = db(`console.log(d.prepare("select slug from shows limit 1").get().slug)`);
for (const target of ["latest", "all"]) {
  const r = await ctx.request.get(`${BASE}/${slug}/embed/${target}`);
  ok(`embed ${target}: 200, framable CSP, no X-Frame-Options, no cookies`, r.status() === 200 && /frame-ancestors \*/.test(r.headers()["content-security-policy"] ?? "") && !r.headers()["x-frame-options"] && !r.headers()["set-cookie"], r.status() + " " + r.headers()["content-security-policy"]);
  const e = await ctx.newPage();
  const cspErr = []; e.on("console", (x) => /Content Security Policy|Refused/.test(x.text()) && cspErr.push(x.text())); e.on("pageerror", (x) => cspErr.push(String(x)));
  await e.setViewportSize({ width: 640, height: 420 });
  await e.goto(`${BASE}/${slug}/embed/${target}?theme=dark&accent=amber`); await sleep(1500);
  ok(`embed ${target}: audiocn player`, (await e.locator("[data-slot=audio-player]").count()) === 1);
  if (target === "all") ok("embed all: audiocn TrackList", (await e.locator("[data-slot=track-list-item]").count()) >= 1);
  await e.click("[data-testid=embed-play]"); await sleep(2500);
  const t = await e.innerText("[data-testid=embed-time]");
  ok(`embed ${target}: plays (time moves)`, /^0:0[1-9]|^0:[1-5]\d/.test(t.trim()), t);
  ok(`embed ${target}: no CSP or script errors`, cspErr.length === 0, cspErr.join(" | "));
  await e.screenshot({ path: `r6-embed-${target}.png` });
  await e.close();
}
// host page: embed.js iframe resizes and re-fires play
const host = await ctx.newPage();
await host.route(BASE + "/__host-test", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><body style="background:#eee;padding:20px"><div id="x" data-podstudio="${slug}/all"></div><script src="/embed.js"></script><script>window.ev=[];document.getElementById("x").addEventListener("podstudio:play",e=>ev.push(e.type))</script></body>` }));
await host.goto(BASE + "/__host-test"); await sleep(2500);
const fr = host.frameLocator("#x iframe");
const h = await host.$eval("#x iframe", (f) => f.getBoundingClientRect().height);
ok("embed.js: iframe auto-resized from the player's message (playlist is taller than 152)", h > 200, String(h));
await fr.locator("[data-testid=embed-play]").click(); await sleep(1500);
ok("embed.js: podstudio:play re-fired on the host element", (await host.evaluate(() => window.ev)).includes("podstudio:play"));
await host.screenshot({ path: "r6-embed-host.png" });
await host.close();
// recorder: audiocn mic setup (device select, meter, level check)
await p.goto(BASE + "/studio/record/solo?episode=" + epId); await p.waitForSelector("[data-testid=solo-stage]");
await p.click("[data-testid=enable-mic]").catch(() => {});
await p.waitForSelector("[data-testid=mic-setup] [data-testid=meter]", { timeout: 20000 });
ok("recorder: audiocn device select shows the mic", /\S/.test(await p.innerText("[data-testid=mic-setup] [data-testid=device]")), await p.innerText("[data-testid=mic-setup] [data-testid=device]"));
await p.click("[data-testid=level-check]"); await sleep(3600);
const verdict = await p.getAttribute("[data-testid=level-verdict]", "data-verdict");
ok("recorder: level check gives a verdict", !!verdict, verdict);
await p.screenshot({ path: "r6-mic-setup.png" });
console.log("errors", errs); console.log("FAILS", failCount()); await b.close();
