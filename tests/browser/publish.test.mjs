// Ready to publish: record 30 s of voice-like audio, export stereo −16 / mono −19 / levelled, check with an independent meter.
import { toStep, pickAndDownload } from './steps.mjs';
import { chromium } from './auth.mjs';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { OUT as S, B, DATA, FIX, TOOLS, CHROME } from './env.mjs';
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', n, x); };
const browser = await chromium.launch({ executablePath: CHROME,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${FIX}/voice-like.wav`] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone'], acceptDownloads: true, viewport: { width: 1300, height: 900 } });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept());
await page.goto(B + '/episodes/142/recording'); await page.waitForTimeout(2000);
await page.click('[data-start]'); await page.waitForTimeout(30000);
await page.keyboard.press('m'); await page.click('[data-end]'); await page.click('dialog [value=end]');
await page.waitForURL('**/saved?take=*');
const take = new URL(page.url()).searchParams.get('take');
await page.goto(`${B}/episodes/142/session?take=${take}`); await page.evaluate(() => sessionStorage.clear()); await page.reload();
await toStep(page, 'loud');
const loudDefaults = (await page.isChecked('[name=pub-loudness][value=stereo]')) && !(await page.isChecked('[name=pub-level]'));
await toStep(page, 'export');
await page.click('[data-export]');
ok('defaults: stereo, levelling off, the episode WAV and MP3 ticked', loudDefaults && (await page.getAttribute('[data-file="Ep142_Episode.wav"]', 'aria-checked')) === 'true' && (await page.getAttribute('[data-file="Ep142_Episode.mp3"]', 'aria-checked')) === 'true');
await page.keyboard.press('Escape');
/** Open the picker, change what `pick` changes, download. */
const exportZip = async (tag, pick = async () => {}) => {
  await page.click('[data-export]');
  await pick();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 240000 }), page.click('[data-picker] [data-download]')]);
  const dir = `${S}/publish/${tag}`;
  await dl.saveAs(`${dir}.zip`);
  execSync(`rm -rf ${dir} && mkdir -p ${dir} && cd ${dir} && unzip -q ../${tag}.zip`);
  return { dir, files: execSync(`ls ${dir}`).toString().trim().split('\n') };
};
const meter = (f) => execSync(`python3 ${TOOLS}/lufs.py ${f}`).toString().trim().split(' ').map(Number);

// 1. Stereo −16 LUFS with MP3
let z = await exportZip('stereo');
ok('zip has the episode WAV and MP3', z.files.some((f) => f.endsWith('_Episode.wav')) && z.files.some((f) => f.endsWith('_Episode.mp3')), z.files.join(', '));
let [lufs, peak, ch] = meter(`${z.dir}/Ep142_Episode.wav`);
ok('stereo episode at −16 LUFS (independent meter)', Math.abs(lufs + 16) < 0.5 && ch === 2, `${lufs} LUFS, ${ch} ch`);
ok('sample peak under −1 dBFS', peak <= -1.0, `${peak} dBFS`);
const report = readFileSync(`${z.dir}/Ep142_Session_export.txt`, 'utf8');
console.log(report);
ok('report gives the loudness', /Episode: −1[56]\.\d LUFS integrated/.test(report));
// The MP3 decodes, and is as long as the WAV.
const wavSec = Number(execSync(`python3 -c "import wave;w=wave.open('${z.dir}/Ep142_Episode.wav');print(w.getnframes()/w.getframerate())"`).toString());
const mp3 = readFileSync(`${z.dir}/Ep142_Episode.mp3`).toString('base64');
const mp3Sec = await page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const buf = await new AudioContext().decodeAudioData(bytes.buffer);
  return buf.duration;
}, mp3);
ok('MP3 decodes, same length as the WAV', Math.abs(mp3Sec - wavSec) < 0.2, `${mp3Sec.toFixed(2)} vs ${wavSec.toFixed(2)} s`);
ok('MP3 has an ID3 tag', readFileSync(`${z.dir}/Ep142_Episode.mp3`).subarray(0, 3).toString() === 'ID3');

// 2. Mono −19 LUFS, levelling on, no MP3
await toStep(page, 'loud');
await page.click('label:has([name=pub-loudness][value=mono])');
await page.click('label:has([name=pub-level])');
await toStep(page, 'export');
let summary = '';
z = await exportZip('mono', async () => {
  await page.click('[data-file="Ep142_Episode.mp3"]');
  summary = await page.textContent('[data-picker-summary]');
});
[lufs, peak, ch] = meter(`${z.dir}/Ep142_Episode.wav`);
ok('mono episode at −19 LUFS (independent meter)', Math.abs(lufs + 19) < 0.5 && ch === 1, `${lufs} LUFS, ${ch} ch`);
ok('no MP3 when it is off', !z.files.some((f) => f.endsWith('.mp3')));
const lev = z.files.find((f) => /_levelled\.wav$/.test(f));
ok('a levelled copy of the edit', !!lev, z.files.join(', '));
const len = (f) => Number(execSync(`python3 -c "import wave;w=wave.open('${z.dir}/${f}');print(w.getnframes())"`).toString());
ok('levelled copy the same length as the edit', lev && len(lev) === len(lev.replace('_levelled', '')), `${lev && len(lev)} vs ${lev && len(lev.replace('_levelled', ''))}`);
ok('the picker counts what the zip has', Number(summary.match(/^(\d+) of/)[1]) === z.files.length, `${summary} vs ${z.files.length}`);

// 3. No episode file: untick the Ready to publish group; the levelled copy still comes
const untick = async (name) => (await page.getAttribute(`[data-file="${name}"]`, 'aria-checked')) === 'true' && page.click(`[data-file="${name}"]`);
z = await exportZip('off', async () => (await untick('Ep142_Episode.wav'), await untick('Ep142_Episode.mp3')));
ok('no episode file when it is unticked, the levelled copy still made', !z.files.some((f) => /_Episode/.test(f)) && z.files.some((f) => /_levelled/.test(f)), z.files.join(', '));
ok('no page errors', !errs.length, errs.join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
await browser.close();
