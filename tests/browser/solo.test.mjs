import { toStep, pickAndDownload } from './steps.mjs';
import { chromium } from './auth.mjs';
import { execSync } from 'node:child_process';
import { OUT as S, B, DATA, FIX, TOOLS, CHROME } from './env.mjs';
const e = '/episodes/142';
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${FIX}/mono11.wav`, '--autoplay-policy=no-user-gesture-required'],
});
const vp = process.argv[2] === 'phone' ? { width: 390, height: 800 } : { width: 1300, height: 800 };
const ctx = await browser.newContext({ ignoreHTTPSErrors: true,  viewport: vp, permissions: ['microphone'], acceptDownloads: true, hasTouch: process.argv[2] === 'phone' });
const errs = [];
const page = await ctx.newPage();
page.on('pageerror', (x) => errs.push(page.url() + ' ' + x.message));
let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', n, x); };
const until = async (fn, ms = 10000) => { const started = Date.now(); while (Date.now() - started < ms) { if (await fn()) return true; await new Promise((resolve) => setTimeout(resolve, 150)); } return false; };
const currentLine = () => page.evaluate(() => Number(document.querySelector('[data-track] [data-l=now]')?.dataset.line));
const markers = () => page.evaluate(() => [...document.querySelectorAll('[data-timeline-marks] > div')].map((d) => d.title.split(' · ')[0]));
const counts = async () => { await page.keyboard.press('m'); const t = await page.locator('[data-counts]').textContent(); await page.keyboard.press('Escape'); return t; };

await page.goto(B + e + '/script');
await page.evaluate(() => localStorage.clear());
await page.goto(B + e + '/recording?legacy=1');
await until(async () => /−1[01] dB/.test(await page.locator('[data-level-text]').textContent()));
const lvl = await page.locator('[data-level-text]').textContent();
ok('meter live before start (the mic check)', /−1[01] dB/.test(lvl), lvl);
ok('ready state', (await page.locator('#recording').getAttribute('data-state')) === 'ready');
await page.click('[data-level]');
await until(async () => /Peak.*dBFS.*RMS/.test(await page.locator('[data-level-rows]').textContent()));
const det = await page.locator('[data-level-rows]').textContent();
ok('level details open with peak and RMS', /Peak.*dBFS.*RMS/.test(det), det.slice(0, 80));
await page.click('[data-level]');

await page.click('[data-start]');
await page.waitForTimeout(1500);
ok('recording', (await page.locator('#recording').getAttribute('data-state')) === 'rec');
ok('REC clock', /REC 00:0\d/.test(await page.locator('[data-rec-label]').textContent()));

// Cough: hold C for 2 s
await page.keyboard.down('c');
await page.waitForTimeout(600);
ok('cough pill', /COUGH · 0:0/.test(await page.locator('[data-pill]').textContent()));
ok('others dimmed', (await page.locator('#recording').getAttribute('data-coughing')) === '');
await page.waitForTimeout(1400);
await page.keyboard.up('c');
ok('cough toast', /Cough · muted in the edit · 0:02/.test(await page.locator('[data-toast-text]').textContent()), await page.locator('[data-toast-text]').textContent());

// Retake, undo, retake
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
const lineBefore = await currentLine();
await page.keyboard.press('r');
ok('retake toast', /Retake marked · Line 3/.test(await page.locator('[data-toast-text]').textContent()));
ok('attempt label', /Attempt 2/i.test(await page.locator('[data-track] [data-l=now]').textContent()));
await page.keyboard.press('u');
ok('undo hides toast', await page.locator('[data-toast]').isHidden());
ok('undo removed the retake', !(await counts()).includes('retake'), await counts());
await page.keyboard.press('r');
await page.waitForTimeout(300);
ok('line kept on retake', (await currentLine()) === lineBefore);

// Ad-lib by hand
await page.keyboard.press('a');
await page.waitForTimeout(1200);
ok('ad-lib pill', /AD-LIB · 0:0/.test(await page.locator('[data-pill]').textContent()));
ok('ad-lib button pressed', (await page.getAttribute('[data-adlib-btn]', 'aria-pressed')) === 'true');
await page.keyboard.press('a');
ok('ad-lib toast', /Ad-lib · 0:01/.test(await page.locator('[data-toast-text]').textContent()), await page.locator('[data-toast-text]').textContent());

// More: jump to section 2 with its key
await page.keyboard.press('m');
ok('More open', await page.locator('[data-more]').isVisible());
await page.keyboard.press('2');
const sec = await page.evaluate(() => document.querySelector('[data-sections] [aria-current]')?.textContent);
ok('section 2 is current', /The install/.test(sec), sec);
ok('mic read-only while recording', await page.locator('[data-mic]').isDisabled());
await page.keyboard.press('Escape');
ok('More closed', await page.locator('[data-more]').isHidden());

// Text size
await page.keyboard.press('Control+Equal');
ok('text size 110%', (await page.evaluate(() => document.getElementById('recording').style.getPropertyValue('--p-device'))) === '1.1');
await page.keyboard.press('Control+Minus');

// Pause, resume with 3-2-1
await page.keyboard.press('p');
ok('paused', (await page.locator('#recording').getAttribute('data-state')) === 'paused');
ok('paused card', await page.locator('[data-paused-card]').isVisible());
await page.waitForTimeout(1000);
await page.keyboard.press('p');
ok('countdown', await page.locator('[data-countdown]').isVisible());
await page.waitForTimeout(3300);
ok('recording again', (await page.locator('#recording').getAttribute('data-state')) === 'rec');

// Double-click the script retakes
const line = await currentLine();
const box = await page.locator(`[data-track] [data-line="${line}"]`).boundingBox();
await page.mouse.click(box.x + 40, box.y + 10);
await page.waitForTimeout(120);
await page.mouse.click(box.x + 40, box.y + 10);
await page.waitForTimeout(200);
ok('double-click = retake', /Retake marked/.test(await page.locator('[data-toast-text]').textContent()));
// Single click jumps (after the double-tap wait)
const next = await page.locator(`[data-track] [data-line="${line + 1}"]`).boundingBox();
await page.mouse.click(next.x + 40, next.y + 10);
await page.waitForTimeout(500);
ok('click jumps a line', (await currentLine()) === line + 1);
if (vp.width > 1000) ok('timeline shows markers', (await markers()).length >= 4, JSON.stringify(await markers()));
const c = await counts();
ok('marker counts', /2 retakes · 1 cough · 1 ad-lib/.test(c), c);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${S}/shots/rec/live-${process.argv[2] ?? 'laptop'}.png` });

// End session
await page.keyboard.press('m');
await page.click('[data-end]');
await page.click('dialog [value=end]');
await page.waitForURL('**/saved?take=*');
await page.waitForTimeout(800);
const summary = await page.locator('[data-summary]').textContent();
ok('saved summary', /2 retakes · 1 cough · 1 ad-lib/.test(summary), summary);
ok('review does not imply an assembled edit', await page.locator('[data-edit]').count() === 0);
await page.screenshot({ path: `${S}/shots/rec/saved-${process.argv[2] ?? 'laptop'}.png` });
await page.getByRole('button', { name: /^(Play|Pause) recording$/ }).click();
await page.waitForTimeout(800);
ok('listen plays', await page.evaluate(() => !document.querySelector('[data-review-audio]').paused));

// Export: raw WAV + markers + edit
await page.click('[data-export]');
await page.waitForURL('**/export-legacy?take=*');
await toStep(page, 'export');
const [dl] = await Promise.all([page.waitForEvent('download'), pickAndDownload(page)]);
const zipPath = `${S}/dl-solo/s.zip`;
await dl.saveAs(zipPath);
execSync(`rm -rf ${S}/dl-solo/x && mkdir -p ${S}/dl-solo/x && cd ${S}/dl-solo/x && unzip -q ../s.zip`);
const files = execSync(`ls ${S}/dl-solo/x`).toString().trim().split('\n');
ok('zip has WAV, labels, CSV, edit (and the voice log)', files.filter((f) => !f.includes('voice-log')).length === 7 && files.some((f) => f.endsWith('_export.txt')) && files.some((f) => f.endsWith('_Episode.mp3')), files.join(', '));
const csv = execSync(`cat ${S}/dl-solo/x/*.csv`).toString();
ok('CSV has the cut', /,cut,/.test(csv), csv.split('\n').slice(0, 6).join(' | '));
const labels = execSync(`cat ${S}/dl-solo/x/*.txt`).toString();
ok('Audacity labels name the cough', /Cough \(muted\)/.test(labels));
console.log(execSync(`cd ${S}/dl-solo/x && for f in *.wav; do python3 -c "import wave,sys;w=wave.open(sys.argv[1]);print(sys.argv[1], round(w.getnframes()/w.getframerate(),2),'s')" "$f"; done`).toString());
// The cough is muted in the edit (silent across it), not cut; the raw WAV still has it.
const cutRow = csv.split('\n').find((l) => /,cut,/.test(l)).split(',');
const [ct, ce] = [Number(cutRow[0]), Number(cutRow[1])];
const wavOf = (suffix) => execSync(`ls ${S}/dl-solo/x/*${suffix}`).toString().trim();
const rms = (suffix, a, b) => Number(execSync(`python3 ${TOOLS}/rms.py '${wavOf(suffix)}' ${a} ${b}`).toString());
const editRms = rms('_edit.wav', ct + 0.05, ct + 1.5);
const rawRms = rms('Tyler.wav', ct + 0.05, ct + 1.5);
ok('cough muted in the edit, not in the raw', editRms < 1e-4 && rawRms > 1e-3, `edit ${editRms.toExponential(1)} raw ${rawRms.toExponential(1)}`);
ok('no page errors', errs.length === 0, errs.join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
await browser.close();
