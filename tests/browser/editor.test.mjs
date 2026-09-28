import { chromium } from './auth.mjs';
import { execSync } from 'node:child_process';
import { OUT, B, CHROME, FIX } from './env.mjs';

let fails = 0;
const ok = (name, condition, detail = '') => { if (!condition) fails++; console.log(condition ? 'PASS' : 'FAIL', name, detail); };
const until = async (fn, ms = 20000) => { const started = Date.now(); while (Date.now() - started < ms) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${OUT}/voice-noisy.wav`, '--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone'], acceptDownloads: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));

await page.goto(`${B}/episodes/142/recording`); await page.waitForTimeout(2500);
await page.click('[data-start]');
ok('recording starts', await until(async () => (await page.locator('#recording').getAttribute('data-state')) === 'rec', 15000), await page.locator('#recording').getAttribute('data-state'));
await page.waitForTimeout(3000); await page.keyboard.press('r'); await page.waitForTimeout(4000);
await page.locator('[data-end]').evaluate((button) => button instanceof HTMLButtonElement && button.click()); await page.click('dialog [value=end]');
await page.waitForURL('**/editor?take=*'); await page.waitForTimeout(2500);
if (!(await page.locator('[data-editor]').count())) console.log('EDITOR DEBUG', page.url(), errors.join(' | '), await page.locator('[data-loading]').textContent().catch(() => 'no loading'));
await page.waitForSelector('[data-editor]', { timeout: 30000 });
ok('desktop End Session opens editor', page.url().includes('/editor?take='));
ok('timeline has a host track', (await page.locator('[data-track]').count()) >= 1);
ok('top and bottom controls are present', (await page.locator('[data-export-open]').count()) === 1 && (await page.locator('[data-editor-play]').count()) === 1);
await page.screenshot({ path: `${OUT}/editor-desktop.png`, fullPage: true });
if (await page.locator('[data-retakes-open]').textContent().then((x) => x.includes('('))) {
  await page.locator('[data-retakes-open]').click();
  ok('retake review shows attempts', (await page.locator('[data-retake]').count()) >= 1);
  await page.getByRole('button', { name: 'Keep last take' }).first().click();
  await page.keyboard.press('Escape');
  ok('retake review clears the required count', !(await page.locator('[data-retakes-open]').textContent()).includes('('));
}
await page.locator('[data-track-fx]').first().click();
ok('FX opens in a sheet', await page.locator('#fx-title').isVisible());
await page.getByRole('button', { name: 'Apply FX' }).click();
ok('server autosave confirms', await until(async () => (await page.locator('[data-save-state]').getAttribute('data-save-state')) === 'saved'));
await ctx.setOffline(true);
await page.locator('input[aria-label$=" level"]').first().evaluate((input) => { input.value = '-1'; input.dispatchEvent(new Event('input', { bubbles: true })); });
ok('offline edits wait for connection', await until(async () => (await page.locator('[data-save-state]').getAttribute('data-save-state')) === 'offline'));
await ctx.setOffline(false);
ok('autosave resumes online', await until(async () => (await page.locator('[data-save-state]').getAttribute('data-save-state')) === 'saved'));
await page.locator('label:has-text("Import audio") input').setInputFiles(`${FIX}/sting.wav`);
ok('browser-decodable import becomes a track', await until(async () => (await page.locator('[data-track]').count()) === 2));
await page.locator('[data-editor-play]').click();
ok('full-session player starts', await until(async () => (await page.locator('[data-editor-play]').getAttribute('aria-label')) === 'Pause'));
await page.locator('[data-editor-play]').click();
await page.locator('[data-export-open]').click();
ok('compact export has fixed WAV and two options', await page.getByText('Finished WAV', { exact: true }).isVisible() && (await page.locator('#export-title').count()) === 1);
await page.getByText('Include raw tracks', { exact: true }).click();
await page.screenshot({ path: `${OUT}/editor-export.png`, fullPage: true });
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.locator('dialog').getByRole('button', { name: 'Export', exact: true }).click()]);
const zipPath = `${OUT}/editor-project.zip`; await download.saveAs(zipPath);
const files = execSync(`unzip -Z1 '${zipPath}'`).toString().trim().split('\n');
ok('export contains finished, host raw, and imported raw files', files.some((x) => x.endsWith('_Finished.wav')) && files.some((x) => x.endsWith('_Host_raw.wav')) && files.some((x) => x.includes('sting_wav_raw.wav')), files.join(' | '));
ok('completion offers sessions, repeat download, and future AI tools', await page.getByText('Your export is ready').isVisible() && await page.getByText('Back to sessions').isVisible() && await page.getByText('Download again').isVisible() && await page.getByText('Optional AI tools').isVisible());

const phone = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mobile = await phone.newPage();
await mobile.goto(page.url());
await mobile.waitForURL('**/saved?take=*');
ok('phone falls back to Session saved', mobile.url().includes('/saved?take='));

ok('no editor page errors', !errors.length, errors.join(' | '));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
await phone.close(); await browser.close();
