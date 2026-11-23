// Regenerates screenshots/*.png from shots.json. Run `npm run build` first.
//   npm run screenshots
// Needs Playwright's Chromium: `npx playwright install chromium` (or set CHROMIUM_PATH).
import { readFileSync, mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { preview } from "vite"

const shots = JSON.parse(readFileSync(new URL("../shots.json", import.meta.url), "utf8"))
const outDir = new URL("../screenshots/", import.meta.url)
mkdirSync(outDir, { recursive: true })

// Vite's own preview server on a free port, so a stale server can never be captured by mistake.
const server = await preview({ preview: { port: 0, strictPort: false, open: false } })
const url = server.resolvedUrls.local[0]

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: s.width ?? 1280, height: s.height ?? 800 }, deviceScaleFactor: 2 })
  await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t) } catch {} }, s.theme ?? "dark")
  const page = await ctx.newPage()
  await page.goto(`${url}#/${s.route}`)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(250)
  await page.screenshot({ path: new URL(`${s.file}.png`, outDir).pathname, fullPage: s.fullPage ?? true })
  await ctx.close()
  console.log("screenshots/" + s.file + ".png")
}
await browser.close()
await server.close()
