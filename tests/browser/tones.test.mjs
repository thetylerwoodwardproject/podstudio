import { toStep, pickAndDownload, resetSettings } from './steps.mjs';
import { chromium } from './auth.mjs';
import { execSync } from 'node:child_process';
import { OUT as S, B, DATA, FIX, TOOLS, CHROME } from './env.mjs';
const browser = await chromium.launch({ executablePath: CHROME,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${FIX}/mono11.wav`, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true,  viewport: { width: 1300, height: 900 }, permissions: ['microphone'], acceptDownloads: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', n, x); };
await page.goto(B + '/settings/recording');
await resetSettings(page, () => ({}), { clear: true });
await page.reload();
await page.waitForSelector('[data-tones] [data-tone-more]');
await page.click('[data-tone-more] summary');
ok('settings show tone defaults', (await page.locator('[data-tone-value=duck]').textContent()) === '−12 dB' && (await page.locator('[data-tone-kind=retake]').isChecked()));
await page.click('label:has([data-tone-kind=cut])'); ok('cough chip ticks', await page.locator('[data-tone-kind=cut]').isChecked());
await page.waitForTimeout(300);
await page.goto(B + '/episodes/142/recording');
await page.waitForTimeout(1500);
await page.click('[data-start]');
await page.waitForTimeout(2000);
await page.keyboard.press('r');
await page.waitForTimeout(2000);
await page.keyboard.down('c'); await page.waitForTimeout(500); await page.keyboard.up('c');
await page.waitForTimeout(2000);
await page.keyboard.press('m'); await page.click('[data-end]'); await page.click('dialog [value=end]');
await page.waitForURL('**/saved?take=*');
await page.click('[data-export]'); await page.waitForURL('**/session?take=*'); await page.evaluate(() => sessionStorage.clear()); await page.reload(); await page.waitForSelector('[data-step-tab]');
ok('switch names the kinds', /retake and cough/.test(await page.locator('[data-tone-kinds]').textContent()), await page.locator('[data-tone-kinds]').textContent());
ok('off by default', !(await page.isChecked('[name=tones]')));
const exportZip = async (dir) => {
  await toStep(page, 'export');
  const [dl] = await Promise.all([page.waitForEvent('download'), pickAndDownload(page)]);
  await dl.saveAs(`${S}/tones/${dir}.zip`);
  execSync(`rm -rf ${S}/tones/${dir} && mkdir -p ${S}/tones/${dir} && cd ${S}/tones/${dir} && unzip -q ../${dir}.zip`);
};
await exportZip('plain');
await page.click('[data-step-tab=edit]'); await page.check('[name=tones]', { force: true });
await exportZip('toned');
console.log(execSync(`cd ${S}/tones && python3 - <<'PY'
import wave, glob, math, csv
def load(f):
    w = wave.open(f); n = w.getnframes(); b = w.readframes(n)
    return [int.from_bytes(b[i:i+3], 'little', signed=True) / 8388608 for i in range(0, len(b), 3)], w.getframerate()
a, r = load(glob.glob('plain/*Tyler.wav')[0]); b, _ = load(glob.glob('toned/*Tyler.wav')[0])
d = [y - x for x, y in zip(a, b)]
changed = [i for i, v in enumerate(d) if abs(v) > 1e-6]
rows = list(csv.reader(open(glob.glob('toned/*markers.csv')[0])))[1:]
marks = [(float(x[0]), x[2]) for x in rows]
print('MARKERS', marks)
# Group changed samples into bursts
bursts = []
for i in changed:
    if bursts and i - bursts[-1][1] < r * 0.05: bursts[-1][1] = i
    else: bursts.append([i, i])
for s, e in bursts:
    pk = max(abs(v) for v in d[s:e+1])
    print('BURST %.3f-%.3f s  peak %.1f dBFS' % (s / r, e / r, 20 * math.log10(pk)))
ea, _ = load(glob.glob('plain/*_edit.wav')[0]); eb, _ = load(glob.glob('toned/*_edit.wav')[0])
print('EDIT SAME', ea == eb, 'LEN SAME', len(a) == len(b))
PY`).toString());
ok('no page errors', !errs.length, errs.join('; '));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
await browser.close();
