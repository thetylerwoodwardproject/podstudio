// Session saved (1e) and Settings → Recording marker tones (1f).
import { chromium } from './auth.mjs';
import { OUT as S, B, DATA, FIX, TOOLS, CHROME } from './env.mjs';
const D = `${S}/flow`;
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', n, x); };
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
const browser = await chromium.launch({ executablePath: CHROME,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${S}/voice-noisy.wav`, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone'], viewport: { width: 1300, height: 900 } });
await ctx.addInitScript(() => { window.__starts = []; const o = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (when) { window.__starts.push({ buf: this.buffer, when }); return o.apply(this, arguments); }; });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.stack.split('\n').slice(0, 5).join(' / ')));
const text = (s) => page.textContent(s).then((t) => t.trim());

// Marker tones in Settings
await page.goto(B + '/settings/recording');
await page.waitForSelector('[data-tones] [data-tone-pitch]');
ok('pitch defaults to 1 kHz', (await text('[data-tone-pitch] button[aria-pressed=true]')) === '1 kHz');
ok('duck shows −12 dB', (await text('[data-tone-value=duck]')) === '−12 dB');
await page.click('[data-tone-pitch] button:has-text("High")');
await page.click('[data-tone-more] summary');
ok('More: retake chip says 1.6 kHz', /1\.6 kHz/.test(await page.locator('label:has([data-tone-kind=retake])').textContent()));
ok('chain names the tone', /Sample retake with 1\.6 kHz tone, −12 dB/.test(await text('[data-tones] [data-chain]')), await text('[data-tones] [data-chain]'));
await page.click('[data-tones] [data-play]');
ok('sample plays', await until(async () => (await page.getAttribute('[data-tones] [data-play]', 'aria-label')) === 'Pause preview', 5000));
const tone = await page.evaluate(() => {
  const g = window.__starts; const last = g.at(-1).when; const bufs = g.filter((s) => s.when === last).map((s) => s.buf.getChannelData(0));
  // Level at 1.6 kHz over the tone (4.0–4.2 s), Goertzel
  const at = (x, f) => { const r = 48000, w = 2 * Math.PI * f / r; let s1 = 0, s2 = 0; for (let i = 4 * r + 500; i < 4.2 * r; i++) { const s = x[i] + 2 * Math.cos(w) * s1 - s2; s2 = s1; s1 = s; } return 20 * Math.log10(Math.sqrt(s1 * s1 + s2 * s2 - 2 * Math.cos(w) * s1 * s2)); };
  return bufs.map((x) => at(x, 1600));
});
ok('With tone has the 1.6 kHz beep at 4 s', tone.length === 2 && tone[1] > tone[0] + 20, tone.map((x) => x.toFixed(1)).join(' vs '));
await page.click('[data-tones] [data-play]');
await page.evaluate(() => { const r = document.querySelector('[data-tone-range=duck]'); r.value = 18; r.dispatchEvent(new Event('input', { bubbles: true })); });
ok('duck slider', (await text('[data-tone-value=duck]')) === '−18 dB');
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
await page.goto(B + '/episodes/142/recording'); await page.waitForTimeout(2000);
await page.click('[data-start]'); await page.waitForTimeout(15000);
await page.keyboard.press('m'); await page.click('[data-end]'); await page.click('dialog [value=end]');
await page.waitForURL('**/saved?take=*');
await page.waitForSelector('[data-play]');
ok('summary: length recorded', /^\d+:\d\d recorded/.test(await text('[data-summary]')), await text('[data-summary]'));
ok('raw WAV row with size', /MB · [\d.]+ kHz · \d+-bit/.test(await text('[data-raw]')), await text('[data-raw]'));
ok('assembled edit row', /after cuts|nothing to cut/.test(await text('[data-edit]')));
ok('no noise switch on the page', (await page.locator('label[for=saved-ns]').count()) === 0);
await page.click('[data-play]');
ok('plays the recording', await until(async () => !(await page.evaluate(() => document.querySelector('[data-player]').paused)), 5000));
ok('chain says Raw WAV', (await text('[data-chain]')) === 'Raw WAV');
await page.click('[data-ab] button:has-text("Cleaned")');
ok('Cleaned: cleaning from here, then cleaned', await until(async () => /Cleaned/.test(await text('[data-chain]')), 120000), await text('[data-chain]'));
ok('still playing', !(await page.evaluate(() => document.querySelector('[data-player]').paused)));
await page.waitForTimeout(1500);
ok('time moves', !/^0:00 \//.test(await text('[data-time]')), await text('[data-time]'));
await page.screenshot({ path: `${D}/saved.png` });
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: `${D}/saved-phone.png` });
ok('phone: no sideways scroll', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
await page.click('[data-export]');
await page.waitForURL('**/session?take=*');
ok('Export opens the flow', await until(async () => (await page.locator('[data-step-tab]').count()) === 5));
ok('no page errors', !errs.length, errs.join(' | '));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
await browser.close();
