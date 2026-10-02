import { chromium } from './auth.mjs';
import { B, CHROME } from './env.mjs';

const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
let failed = 0;
const ok = (label, value) => { console.log(value ? 'PASS' : 'FAIL', label); if (!value) failed++; };

await page.goto(B);
await page.evaluate(async () => {
  for (let i = 0; i < 12; i++) {
    const response = await fetch('/api/episodes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `Pagination fixture ${i + 1}` }) });
    if (!response.ok) throw new Error(`Episode setup failed: ${response.status}`);
  }
});
await page.reload();
ok('first library page has ten entries', await page.locator('[data-row]:visible').count() === 10);
ok('pagination appears for a longer library', await page.locator('[data-pagination]').isVisible());
await page.locator('[data-page-next]').click();
ok('next page shows remaining entries', await page.locator('[data-row]:visible').count() === 3);
await page.locator('[data-search]').fill('Pagination fixture 12');
ok('search resets pagination and narrows results', await page.locator('[data-row]:visible').count() === 1 && await page.locator('[data-pagination]').isHidden());
await page.locator('[data-row]:visible a').first().click();
ok('episode breadcrumb links back to library', await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Episodes' }).isVisible());

await browser.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exitCode = failed ? 1 : 0;
