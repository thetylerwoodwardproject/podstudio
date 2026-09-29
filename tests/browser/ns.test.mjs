import { toStep, pickAndDownload, resetSettings } from './steps.mjs';
import { chromium } from './auth.mjs';
import { execSync } from 'node:child_process';
import { OUT as S, B, DATA, FIX, TOOLS, CHROME } from './env.mjs';
const e = '/episodes/142';
const browser = await chromium.launch({ executablePath: CHROME,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${FIX}/noisy-guest.wav`, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true,  viewport: { width: 1300, height: 900 }, permissions: ['microphone'], acceptDownloads: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (x) => errs.push(x.message)); page.on('console', (m) => m.type() === 'error' && !m.location().url.endsWith('/favicon.ico') && errs.push('console: ' + m.text()));
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', n, x); };
await page.goto(B + e + '/script'); await resetSettings(page, () => ({}), { clear: true });
await page.goto(B + e + '/recording?legacy=1');
await page.waitForTimeout(1500);
await page.click('[data-start]');
await page.waitForTimeout(12000);
await page.keyboard.press('m'); await page.click('[data-end]'); await page.click('dialog [value=end]');
await page.waitForURL('**/saved?take=*');
await page.getByRole('button', { name: /^(Play|Pause) recording$/ }).click();
await page.getByRole('button', { name: 'Pause recording', exact: true }).waitFor();
ok('saved: raw recording plays', !(await page.evaluate(() => document.querySelector('[data-review-audio]').paused)));
await page.getByRole('button', { name: /^(Play|Pause) recording$/ }).click();

await page.click('[data-export]'); await page.waitForURL('**/export-legacy?take=*'); await page.evaluate(() => sessionStorage.clear()); await page.reload();
await toStep(page, 'noise');
await page.evaluate(() => { const r = document.querySelector('[data-ns-amount]'); r.value = 70; r.dispatchEvent(new Event('input', { bubbles: true })); });
ok('fader shows 70 %', (await page.locator('[data-ns-value]').textContent()) === '70 %');
let t = Date.now();
await page.click('[data-play]');
for (let i = 0; i < 60 && (await page.getAttribute('[data-play]', 'aria-label')) !== 'Pause preview'; i++) { await page.waitForTimeout(3000); console.log('status:', await page.locator('[data-chain]').textContent(), errs.join('|')); }
const meter = await page.locator('[data-ns-reduction]').textContent();
console.log('preview took', ((Date.now() - t) / 1000).toFixed(1), 's');
ok('attenuation meter', /Background −\d+ dB/.test(meter) && Number(meter.match(/\d+/)[0]) >= 8, meter);
await page.screenshot({ path: S + '/ns/export.png', fullPage: true });
ok('plays cleaned', (await page.locator('[data-ab] button[aria-pressed=true]').textContent()) === 'Cleaned');
await page.click('[data-ab] button:has-text("Original")');
ok('A/B to original', (await page.locator('[data-chain]').textContent()) === 'Edit');
await page.click('[data-play]');
ok('says both versions', /_clean/.test(await page.locator('[data-step-page]').textContent()));
ok('credit link', (await page.getAttribute('a[href="/settings/about"]', 'href')) === '/settings/about');
await toStep(page, 'export');
const summary = await page.locator('[data-summary]').textContent();
t = Date.now();
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), pickAndDownload(page)]);
console.log('export took', ((Date.now() - t) / 1000).toFixed(1), 's');
await dl.saveAs(`${S}/ns/x.zip`);
execSync(`rm -rf ${S}/ns/x && mkdir -p ${S}/ns/x && cd ${S}/ns/x && unzip -q ../x.zip`);
const files = execSync(`ls ${S}/ns/x`).toString().trim().split('\n');
ok('zip has unprocessed and cleaned WAV and edit', files.filter((f) => !f.includes('voice-log')).length === 9 && ['_Tyler.wav', '_Tyler_clean.wav', '_Tyler_edit.wav', '_Tyler_edit_clean.wav'].every((x) => files.some((f) => f.endsWith(x))), files.join(', '));
ok('summary counts both versions (what the zip has)', summary.startsWith(`${files.length} of`), `${summary} vs ${files.length}`);
console.log(execSync(`cd ${S}/ns/x && python3 - <<'PY'
import wave, glob, struct, math
def load(f):
    w = wave.open(f); n = w.getnframes(); b = w.readframes(n); sw = w.getsampwidth()
    if sw == 3: x = [int.from_bytes(b[i:i+3], 'little', signed=True) / 8388608 for i in range(0, len(b), 3)]
    else: x = [v / 32768 for v in struct.unpack('<%dh' % (len(b)//2), b)]
    return x, w.getframerate()
raw, r = load(glob.glob('*Tyler.wav')[0]); clean, _ = load(glob.glob('*Tyler_clean.wav')[0]); edit, _ = load(glob.glob('*_edit.wav')[0]); editc, _ = load(glob.glob('*_edit_clean.wav')[0])
print('lengths raw', len(raw), 'clean', len(clean), 'edit', len(edit), 'edit_clean', len(editc))
print('UNPROCESSED EDIT == RAW', edit == raw, '| CLEAN EDIT == CLEAN', editc == clean)
blk = r // 10
e = lambda x, o: sum(v*v for v in x[o:o+blk]) / blk + 1e-12
blocks = sorted(range(0, len(raw) - blk, blk), key=lambda o: e(raw, o))
quiet = blocks[:len(blocks)//5]; loud = blocks[-len(blocks)//5:]
db = lambda x, bs: 10 * math.log10(sum(e(x, o) for o in bs) / len(bs))
print('BG', round(db(raw, quiet) - db(clean, quiet), 1), 'SPEECH', round(db(clean, loud) - db(raw, loud), 2))
PY`).toString());
// Mic check: test recording, then hear it cleaned and keep the setting
await page.goto(B + e + '/mic-check');
await page.waitForTimeout(2500);
await page.click('[data-step-tab=test]');
await page.click('[data-test-btn]');
await page.waitForTimeout(11500);
await page.click('[data-step-tab=noise]');
ok('mic check offers noise suppression', await page.locator('[data-ns-test]').isVisible(), await page.locator('[data-ns-suggest]').textContent());
await page.evaluate(() => { const r = document.querySelector('[data-ns-test-amount]'); r.value = 60; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
for (let i = 0; i < 60 && (await page.locator('[data-chain]').textContent()).trim() !== 'Test recording → Noise 60 %'; i++) await page.waitForTimeout(500);
await page.screenshot({ path: S + '/ns/miccheck.png' });
ok('hear it cleaned', (await page.locator('[data-chain]').textContent()).trim() === 'Test recording → Noise 60 %');
await page.goto(B + '/settings/recording');
await page.waitForTimeout(500);
ok('settings shows the saved default', (await page.locator('[data-ns-value]').textContent()) === '60%');
await page.goto(B + '/settings/about');
ok('credits list DeepFilterNet3', /DeepFilterNet3[\s\S]*MIT or Apache-2.0/.test(await page.locator('main').textContent()));
await page.screenshot({ path: S + '/ns/about.png', fullPage: true });
ok('no page errors', !errs.length, errs.join('; '));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
await browser.close();
