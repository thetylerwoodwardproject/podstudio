// Session saved (1e) and Settings → Recording marker tones (1f).
import { chromium } from './auth.mjs';
import { OUT as S, B, DATA, FIX, TOOLS, CHROME } from './env.mjs';
const D = `${S}/flow`;
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', n, x); };
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
const launch = () => chromium.launch({ executablePath: CHROME,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${S}/voice-noisy.wav`, '--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
let browser = await launch();
let ctx = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone'], viewport: { width: 1300, height: 900 } });
await ctx.addInitScript(() => { window.__starts = []; const o = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (when) { window.__starts.push({ buf: this.buffer, when }); return o.apply(this, arguments); }; });
let page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.stack.split('\n').slice(0, 5).join(' / ')));
const text = (s) => page.textContent(s).then((t) => t.trim());

// Marker tones in Settings
await page.goto(B + '/settings/recording');
await page.waitForSelector('[data-tones] [data-tone-pitch]');
ok('pitch defaults to 1 kHz', (await text('[data-tone-pitch] button[aria-pressed=true]')) === '1 kHz');
ok('duck shows −12 dB', (await text('[data-tone-value=duck]')) === '−12 dB');
await page.click('[data-tone-pitch] button:has-text("High")');
await page.click('[data-tone-more] summary');
ok('More: retake chip says 1.6 kHz', /1\.6 kHz/.test(await page.locator('div:has(> [data-tone-kind=retake])').textContent()));
ok('all five clean previews are present', (await page.locator('[data-tone-preview]').count()) === 5);
ok('retake preview says 1.6 kHz', /1\.6 kHz/.test(await text('[data-tone-preview=retake]')));
await page.click('[data-tone-preview=retake]');
ok('retake preview plays', /Stop/.test(await page.getAttribute('[data-tone-preview=retake]', 'aria-label')));
const tone = await page.evaluate(() => {
  const x = window.__starts.at(-1).buf.getChannelData(0); let crossings = 0;
  for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) crossings++;
  return crossings / 2 / (x.length / 48000);
});
ok('retake preview is a clean 1.6 kHz tone', Math.abs(tone - 1600) < 20, `${tone.toFixed(1)} Hz`);
await page.route('**/api/me/settings', (route) => route.abort());
await page.evaluate(() => { const r = document.querySelector('[data-tone-range=duck]'); r.value = 18; r.dispatchEvent(new Event('input', { bubbles: true })); });
ok('duck slider', (await text('[data-tone-value=duck]')) === '−18 dB');
ok('offline save waits for connection', await until(async () => (await page.locator('[data-save-status]').getAttribute('data-save-status')) === 'waiting'));
await page.unroute('**/api/me/settings');
await page.evaluate(() => { const r = document.querySelector('[data-tone-range=duck]'); r.value = 17; r.dispatchEvent(new Event('input', { bubbles: true })); r.value = 18; r.dispatchEvent(new Event('input', { bubbles: true })); });
ok('save indicator returns to green', await until(async () => (await page.locator('[data-save-status]').getAttribute('data-save-status')) === 'saved'));
await page.locator('[data-tones]').screenshot({ path: `${D}/tones-card.png` });
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('podstudio:settings')).recording.tones);
ok('saved: pitch high, duck 18', saved.pitch === 'high' && saved.duck === 18, JSON.stringify(saved));
await page.reload(); await page.waitForSelector('[data-tones] [data-tone-pitch]');
ok('remembered after reload', (await text('[data-tone-pitch] button[aria-pressed=true]')) === 'High');
// Put them back
await page.click('[data-tone-pitch] button:has-text("1 kHz")');
await page.evaluate(() => { const r = document.querySelector('[data-tone-range=duck]'); r.value = 12; r.dispatchEvent(new Event('input', { bubbles: true })); });
await page.setViewportSize({ width: 390, height: 844 });
await page.locator('[data-tones]').screenshot({ path: `${D}/tones-card-phone.png` });
await page.setViewportSize({ width: 1300, height: 900 });

// Session saved
await browser.close(); browser = await launch();
ctx = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone'], viewport: { width: 1300, height: 900 } });
page = await ctx.newPage(); page.on('pageerror', (e) => errs.push(e.stack.split('\n').slice(0, 5).join(' / ')));
await page.goto(B + '/episodes/142/recording?legacy=1'); await page.waitForTimeout(2000);
await page.click('[data-start]'); await page.waitForTimeout(15000);
await page.keyboard.press('m'); await page.click('[data-end]'); await page.click('dialog [value=end]');
await page.waitForURL('**/saved?take=*');
await page.waitForSelector('[data-recording-review]');
ok('summary: length recorded', /^\d+:\d\d recorded/.test(await text('[data-summary]')));
ok('no automatic assembled-edit claim', await page.locator('[data-edit]').count() === 0);
await page.getByRole('button', { name: 'Play recording', exact: true }).click();
ok('plays recording', await until(async () => !(await page.locator('[data-review-audio]').evaluate((audio) => audio.paused))));
await page.waitForTimeout(1500);
ok('time moves', !/^0:00 \//.test(await text('[data-review-time]')));
await page.getByLabel('Recording position').evaluate((input) => { input.value = '5'; input.dispatchEvent(new Event('change', { bubbles: true })); });
ok('scrubber seeks', await until(async () => /^0:0[5-9] \//.test(await text('[data-review-time]'))));
await page.screenshot({ path: `${D}/saved.png` });
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: `${D}/saved-phone.png` });
ok('phone: no sideways scroll', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
ok('phone never offers desktop editor', await page.locator('[data-desktop-editor]').isHidden());
const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-raw-download]').first().click()]);
ok('raw download is a WAV', download.suggestedFilename().endsWith('_Host_raw.wav'));
ok('no page errors', !errs.length, errs.join(' | '));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
await browser.close();
