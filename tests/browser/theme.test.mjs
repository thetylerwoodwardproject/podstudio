import { chromium } from './auth.mjs';
import { B, CHROME, OUT } from './env.mjs';

const browser = await chromium.launch({ executablePath: CHROME, args: ['--disable-audio-output'] });
const context = await browser.newContext({ ignoreHTTPSErrors: true, colorScheme: 'light', viewport: { width: 1360, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let failures = 0;
function check(label, success, detail = '') {
  if (!success) failures++;
  console.log(success ? 'PASS' : 'FAIL', label, detail);
}
async function until(checker, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await checker()) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}
const theme = () => page.locator('html').getAttribute('data-theme');
const accentText = () => page.evaluate(() => {
  const sample = document.createElement('span');
  sample.className = 'text-accent-foreground';
  document.body.append(sample);
  const color = getComputedStyle(sample).color;
  sample.remove();
  return color;
});

const initialSettings = page.waitForResponse((response) =>
  response.url().endsWith('/api/me/settings') && response.request().method() === 'GET',
);
await page.goto(`${B}/settings/general`);
await page.waitForSelector('[data-ui-theme]');
await initialSettings;
await page.waitForTimeout(500);
check('Appearance select fills its settings row', await page.locator('[data-ui-theme]').evaluate((select) => {
  const row = select.closest('.relative');
  return !!row && Math.abs(select.getBoundingClientRect().width - row.getBoundingClientRect().width) < 1;
}));
await page.locator('[data-ui-theme]').first().selectOption('system');
check('system follows a light device', (await theme()) === 'light');
await page.emulateMedia({ colorScheme: 'dark' });
check('system follows a dark device', await until(async () => (await theme()) === 'dark'));

await page.locator('[data-ui-theme]').first().selectOption('light');
check('explicit light choice overrides a dark device', (await theme()) === 'light');
check('theme selection saves to the server', await until(async () => {
  const response = await page.evaluate(() => fetch('/api/me/settings').then((r) => r.json()));
  return response.settings?.ui?.theme === 'light';
}));
await page.reload();
check('theme survives reload', (await theme()) === 'light');
check('theme control only appears in Settings', await page.locator('header [data-ui-theme]').count() === 0 && await page.locator('[data-ui-theme]').count() === 1);
const lightAccentText = await accentText();
check('shadcn accent text maps to the light theme', lightAccentText === 'rgb(32, 43, 23)', lightAccentText);
await page.screenshot({ path: `${OUT}/theme-settings-desktop-light.png`, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: `${OUT}/theme-settings-phone-light.png`, fullPage: true });
await page.setViewportSize({ width: 1360, height: 900 });

await page.goto(`${B}/settings/about`);
const credits = await page.locator('body').textContent();
check('Settings credits name the UI sources', ['shadcn-svelte', 'Bits UI', 'More Shadcn Svelte', 'Lucide'].every((name) => credits.includes(name)));
check('vendored component licenses are linked', (await page.locator('a[href^="/vendor/"]').count()) >= 4);
const licensesReachable = await page.locator('a[href^="/vendor/"]').evaluateAll(async (links) => {
  const responses = await Promise.all(links.map((link) => fetch(link.getAttribute('href'))));
  return responses.every((response) => response.ok);
});
check('license notices are served', licensesReachable);
await page.screenshot({ path: `${OUT}/theme-about-light.png`, fullPage: true });

await page.goto(`${B}/settings/general`);
await page.locator('[data-ui-theme]').selectOption('dark');
check('dark choice is applied', (await theme()) === 'dark');
await until(async () => page.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor === 'rgb(18, 18, 37)'));
const darkAccentText = await accentText();
check('shadcn accent text maps to the dark theme', darkAccentText === 'rgb(21, 18, 41)', darkAccentText);
await page.screenshot({ path: `${OUT}/theme-settings-desktop-dark.png`, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: `${OUT}/theme-settings-phone-dark.png`, fullPage: true });
await page.setViewportSize({ width: 1360, height: 900 });
await page.goto(`${B}/settings/about`);
await page.screenshot({ path: `${OUT}/theme-about-dark.png`, fullPage: true });

await page.goto(`${B}/settings/general`);
await page.locator('[data-ui-theme]').selectOption('system');
check('no browser errors', errors.length === 0, errors.join(' | '));
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exitCode = failures ? 1 : 0;
await browser.close();
