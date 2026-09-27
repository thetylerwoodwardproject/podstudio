// The Export step flow, end to end: tabs, the chain preview (noise reaching Tone and Loudness), export.
import { resetSettings } from './steps.mjs';
import { chromium } from './auth.mjs';
import { execSync } from 'node:child_process';
import { OUT as S, B, DATA, FIX, TOOLS, CHROME } from './env.mjs';
const D = `${S}/flow`;
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', n, x); };
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
const browser = await chromium.launch({ executablePath: CHROME,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${S}/voice-noisy.wav`, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone'], acceptDownloads: true, viewport: { width: 1300, height: 900 } });
// Every buffer the preview plays, to measure what's heard
await ctx.addInitScript(() => { window.__starts = []; const o = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (when, off) { window.__starts.push({ buf: this.buffer, when }); return o.apply(this, arguments); }; });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.stack.split('\n').slice(0, 5).join(' / '))); page.on('dialog', (d) => d.accept());
await page.goto(B + '/settings/recording');
await resetSettings(page, (s) => { s.recording ??= {}; s.recording.noiseSuppression = 0; s.recording.exportFiles = null; s.recording.publish = { ...s.recording.publish, voices: {}, meter: true, level: false, loudness: 'stereo' }; return s; });
let take = process.env.TAKE;
if (!take) {
  await page.goto(B + '/episodes/142/recording'); await page.waitForTimeout(2000);
  await page.click('[data-start]'); await page.waitForTimeout(40000);
  await page.keyboard.press('m'); await page.click('[data-end]'); await page.click('dialog [value=end]');
  await page.waitForURL('**/saved?take=*');
  take = new URL(page.url()).searchParams.get('take');
  console.log('take', take);
}
await page.goto(`${B}/episodes/142/session?take=${take}`);
await page.evaluate(() => sessionStorage.clear()); await page.reload();
await page.waitForSelector('[data-step-tab]');

const tabs = page.locator('[data-step-tab]');
ok('five tabs', (await tabs.count()) === 5);
ok('later tabs locked', await page.isDisabled('[data-step-tab="noise"]') && await page.isDisabled('[data-step-tab="export"]'));
ok('step 1 is Edit', (await page.textContent('[data-step-title]')) === 'Edit');
ok('assembled on, removes text', (await page.isChecked('[name=assembled]')) && /Removes|Nothing/.test(await page.textContent('[data-removes]')));
ok('A/B is Raw / Edit, on Edit', (await page.locator('[data-ab] button, [data-ab] label').allTextContents()).map((s) => s.trim()).join('/') === 'Raw/Edit');
ok('header shows the length', /^\d+:\d\d$/.test(await page.textContent('[data-length]')));
await page.screenshot({ path: `${D}/01-edit.png` });
const text = (s) => page.textContent(s).then((t) => t.trim());
ok('Next says Next: Noise', (await text('[data-next]')) === 'Next: Noise');

// Edit preview plays
await page.click('[data-play]');
ok('edit preview plays', await until(async () => (await page.getAttribute('[data-play]', 'aria-label')) === 'Pause preview', 30000), await text('[data-chain]'));
ok('chain says Edit', (await text('[data-chain]')) === 'Edit');
await page.waitForTimeout(1500);
const t1 = await text('[data-time]');
await page.click('[data-ab] button:has-text("Raw")');
await page.waitForTimeout(300);
const t2 = await text('[data-time]');
ok('A/B keeps the playhead', t1.split(' / ')[0] <= t2.split(' / ')[0] && t2 !== '0:00 / 0:30', `${t1} → ${t2}`);
ok('chain says Raw', (await text('[data-chain]')) === 'Raw');

// Noise
await page.click('[data-next]');
ok('now on Noise, tab 01 done (green)', (await text('[data-step-title]')) === 'Background noise' && /text-ok/.test(await page.getAttribute('[data-step-tab="edit"] span', 'class')));
ok('playback stopped, back to after', (await page.getAttribute('[data-play]', 'aria-label')) === 'Play preview' && (await text('[data-time]')).startsWith('0:00'));
ok('room noise measured', await until(async () => /dBFS/.test(await text('[data-ns-floor]')), 10000), await text('[data-ns-floor]'));
const useBtn = page.locator('[data-ns-use]');
if (await useBtn.count()) { await useBtn.click(); ok('Use N % sets the fader', (await text('[data-ns-value]')) !== 'Off', await text('[data-ns-value]')); }
const setNs = (v) => page.evaluate((v) => { const r = document.querySelector('[data-ns-amount]'); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); }, v);
await setNs(60);
ok('fader 60 %', (await text('[data-ns-value]')) === '60 %' && /Background −24 dB/.test(await text('[data-ns-reduction]')));
await page.click('[data-play]');
ok('noise preview plays (cleaning)', await until(async () => (await page.getAttribute('[data-play]', 'aria-label')) === 'Pause preview', 120000), await text('[data-chain]'));
ok('chain: Edit → Noise 60 %', (await text('[data-chain]')) === 'Edit → Noise 60 %', await text('[data-chain]'));
ok('reduction measured', /Background −\d+ dB/.test(await text('[data-ns-reduction]')), await text('[data-ns-reduction]'));
await page.click('[data-ab] button:has-text("Removed")');
ok('Removed: only the removed noise', (await text('[data-chain]')) === 'Only the removed noise');
await page.screenshot({ path: `${D}/02-noise.png` });

/** The noise floor (quietest tenth of 100 ms blocks) of each buffer in the last play. */
const floors = () => page.evaluate(() => {
  const g = window.__starts; const last = g.at(-1).when;
  return g.filter((s) => s.when === last).map((s) => { const x = s.buf.getChannelData(0); const B = Math.round(s.buf.sampleRate / 10); const lv = []; for (let o = 0; o + B <= x.length; o += B) { let e = 0; for (let i = o; i < o + B; i++) e += x[i] * x[i]; const d = 10 * Math.log10(e / B); if (d > -100) lv.push(d); } lv.sort((a, b) => a - b); return lv[Math.floor(lv.length * 0.1)]; });
});
const noiseFloors = await floors();
ok('noise step: cleaned quieter between words than original', noiseFloors[1] < noiseFloors[0] - 10, noiseFloors.map((f) => f.toFixed(1)).join(' '));

// Tone, heard on the cleaned audio
await page.click('[data-next]');
ok('Tone step, Before / With tone', (await page.locator('[data-ab] button').allTextContents()).join('/') === 'Before/With tone');
await page.click('[data-play]');
ok('tone preview plays', await until(async () => (await page.getAttribute('[data-play]', 'aria-label')) === 'Pause preview', 60000), await text('[data-chain]'));
ok('chain: Edit → Noise 60 % → Tone', (await text('[data-chain]')) === 'Edit → Noise 60 % → Tone');
const toneNs = await floors();
ok('voice measured, curves drawn', await until(async () => (await page.locator('[data-tone-eq-svg] [data-voice]').count()) === 1, 20000));
ok('live spectrum on the graph', await until(async () => (await page.locator('[data-tone-eq-svg] [data-spectrum]').count()) === 1, 5000));
await page.click('[data-tone-match]');
ok('Match to target sets bands, preset Custom', (await page.locator('[data-tone-bands] [data-v]').allTextContents()).some((v) => v !== '0') && (await page.locator('[data-tone-presets] button[aria-pressed=true]').textContent()) === 'Custom');
await page.click('[data-tone-presets] button:has-text("Clear")');
await page.click('[data-tone-view] button:has-text("Compressor")');
await page.click('[data-tone-comp-presets] button:has-text("Medium")');
ok('compressor Medium with its help', /About 6 dB/.test(await text('[data-tone-comp-help]')));
await page.click('[data-tone-more] summary');
await page.waitForTimeout(800);
ok('More: the curve and gain reduction while playing', (await page.locator('[data-tone-comp-plot] circle').count()) === 1 && (await text('[data-tone-gr]')) !== '—');
await page.screenshot({ path: `${D}/03-tone-comp.png` });
await page.click('[data-tone-view] button:has-text("Graphic EQ")');
await page.click('[data-play]');
await page.screenshot({ path: `${D}/03-tone.png` });

// The same Tone preview with noise off: the room comes back
await page.click('[data-back]');
await setNs(0);
await page.click('[data-next]');
await page.click('[data-play]');
await until(async () => (await page.getAttribute('[data-play]', 'aria-label')) === 'Pause preview', 60000);
const toneOff = await floors();
await page.click('[data-play]');
ok('Tone preview hears the noise stage (with tone, 60 % vs off)', toneNs[1] < toneOff[1] - 8, `${toneNs[1].toFixed(1)} vs ${toneOff[1].toFixed(1)} dB`);
await page.click('[data-back]'); await setNs(60); await page.click('[data-next]');

// Loudness
await page.click('[data-next]');
ok('Loudness readouts (made straight away)', await until(async () => /^−1[56]\.\d/.test(await text('[data-loud="After"]')), 120000), await text('[data-loud="After"]'));
ok('measured below the target before', /^−\d/.test(await text('[data-loud="Measured"]')) && /dBTP/.test(await text('[data-loud="True peak"]')));
ok('loudness graph drawn', (await page.locator('[data-loud-history]').count()) === 1);
await page.click('[data-play]');
await until(async () => (await page.getAttribute('[data-play]', 'aria-label')) === 'Pause preview', 60000);
const loudFloors = await floors();
await page.click('[data-play]');
ok('Levelled still clean (floor)', loudFloors[1] < toneOff[1] - 8, `${loudFloors[1].toFixed(1)}`);
ok('chain: … → −16 LUFS', (await text('[data-chain]')) === 'Edit → Noise 60 % → Tone → −16 LUFS', await text('[data-chain]'));
await page.click('label:has([name=pub-loudness][value=mono])');
ok('mono target', (await text('[data-pub-target]')) === '−19 LUFS');
ok('re-measured at −19', await until(async () => /^−(19|18|20)\.\d/.test(await text('[data-loud="After"]')), 60000), await text('[data-loud="After"]'));
await page.screenshot({ path: `${D}/04-loudness.png` });

// Export
await page.click('[data-next]');
ok('chain summary, 4 rows', (await page.locator('[data-chain-summary] [data-change]').count()) === 4);
const sum = await page.locator('[data-chain-summary]').textContent();
ok('summary: Noise 60 %, Clear EQ, medium compression, Mono −19', /60 %, background −\d+ dB/.test(sum) && /Clear EQ, medium compression/.test(sum) && /Mono, −19 LUFS/.test(sum), sum);
ok('Next says Export…', (await text('[data-next]')) === 'Export…');
ok('zip card: every file from your chain', (await text('[data-zip-title]')) === 'Every file from your chain' && /^11 of 11 · [\d.]+ MB$/.test(await text('[data-summary]')), `${await text('[data-zip-title]')} · ${await text('[data-summary]')}`);
await page.screenshot({ path: `${D}/05-export.png` });
// Change → goes to that step
await page.click('[data-change="noise"]');
ok('Change jumps to Noise', (await text('[data-step-title]')) === 'Background noise');
await page.click('[data-step-tab="export"]');

// The picker
await page.click('[data-export]');
await page.waitForSelector('[data-picker] [data-file]');
const rows = page.locator('[data-picker] [data-file]');
ok('picker: 11 files in 4 groups, all ticked', (await rows.count()) === 11 && (await page.locator('[data-file-group]').count()) === 4 && (await page.locator('[data-picker] [data-file][aria-checked=true]').count()) === 11);
ok('Everything is the active quick pick', (await page.getAttribute('[data-quick=everything]', 'aria-pressed')) === 'true');
ok('each file says what it is and its size', /noise suppression applied/.test(await page.textContent('[data-file="Ep142_Session_Tyler_clean.wav"]')) && /MB|KB/.test(await page.textContent('[data-file="Ep142_Session_Tyler_clean.wav"]')));
await page.screenshot({ path: `${D}/06-picker.png` });
await page.click('[data-quick=publish]');
ok('To publish: just the episode and its MP3', (await text('[data-picker-summary]')).startsWith('2 of 11') && (await page.getAttribute('[data-quick=publish]', 'aria-pressed')) === 'true');
await page.screenshot({ path: `${D}/06-picker-publish.png` });
await page.click('[data-group-toggle=raw]');
ok('All in a group ticks it', (await text('[data-picker-summary]')).startsWith('4 of 11') && (await text('[data-group-toggle=raw]')) === 'None');
await page.keyboard.press('Escape');
ok('Esc closes; the ticks stay for this visit', (await page.locator('[data-picker][open]').count()) === 0 && (await text('[data-zip-title]')) === '4 of 11 files picked');
// Pick everything but the voice log and the CSV, remember it, download
await page.click('[data-choose-files]');
await page.click('[data-quick=everything]');
await page.click('[data-file="Ep142_Session_voice-log.txt"]');
await page.focus('[data-file="Ep142_Session_markers.csv"]');
await page.keyboard.press('Space');
await page.click('label:has([data-remember])');
ok('Download 9 files', (await text('[data-download]')) === 'Download 9 files');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 400000 }), page.click('[data-download]')]);
execSync(`rm -rf ${D}/x && mkdir -p ${D}/x`);
await dl.saveAs(`${D}/x/x.zip`);
execSync(`cd ${D}/x && unzip -q x.zip && rm x.zip`);
const files = execSync(`ls ${D}/x`).toString().trim().split('\n');
ok('the zip is exactly the 9 ticked files', files.length === 9 && !files.some((f) => /voice-log|markers\.csv/.test(f)), files.join(', '));
ok('clean copies and a mono episode', files.some((f) => f.endsWith('_clean.wav')) && files.some((f) => f.endsWith('_Episode.wav')) && files.some((f) => f.endsWith('_Episode.mp3')));
const [l] = execSync(`python3 ${TOOLS}/lufs.py ${D}/x/*_Episode.wav`).toString().trim().split(' ').map(Number);
ok('episode at −19 LUFS (independent meter)', Math.abs(l + 19) < 0.6, String(l));
const report = execSync(`cat ${D}/x/*_export.txt`).toString();
ok('report: from the noise-suppressed audio, compressor Medium', /from the noise-suppressed audio/.test(report) && /compressor Medium/.test(report), report.split('\n').find((x) => x.startsWith('Episode')));
ok('what the episode measured', await until(async () => /^−1[89]\.\d/.test(await text('[data-measured-value="Integrated"]')), 5000));
await page.screenshot({ path: `${D}/05-export-done.png`, fullPage: true });

// Saved on the server, as kinds
const onServer = await page.evaluate(async () => (await (await fetch('/api/me/settings')).json()).settings.recording.exportFiles);
ok('selection saved to the server as kinds', Array.isArray(onServer) && onServer.includes('voice_edit_clean.wav') && !onServer.includes('markers.csv') && !onServer.includes('voice-log.txt'), JSON.stringify(onServer));
// Reload: same step and settings
await page.reload(); await page.waitForSelector('[data-step-tab]');
ok('after a reload: your saved selection', (await text('[data-zip-title]')) === 'Your saved selection');
// Another browser with nothing stored gets it from the server
{
  const other = await browser.newContext({ ignoreHTTPSErrors: true });
  const p2 = await other.newPage();
  await p2.goto(B + '/settings/recording');
  // The page reloads itself once the server's settings arrive: read between reloads.
  const got = async () => p2.evaluate(() => JSON.parse(localStorage.getItem('podstudio:settings') || '{}').recording?.exportFiles).catch(() => undefined);
  const shown = async () => p2.textContent('[data-export-files-text]').catch(() => '');
  ok('a fresh browser gets the settings from the server', await until(async () => Array.isArray(await got()), 8000), JSON.stringify(await got()));
  ok('Settings shows the saved selection', await until(async () => /Your saved selection/.test(await shown()), 8000), await shown());
  await p2.screenshot({ path: `${D}/settings-files.png`, fullPage: true });
  await other.close();
}
ok('reload keeps the step and settings', (await text('[data-step-title]')) === 'Export' && /Noise 60 %|60 %/.test(await page.locator('[data-chain-summary]').textContent()));

// The tone is remembered by name
await page.goto(B + '/settings/recording'); await page.waitForTimeout(800);
ok('Settings lists the tone', /Tyler: EQ Clear, compressor Medium/.test(await page.locator('[data-voices-text]').textContent()), await page.locator('[data-voices-text]').textContent());
await page.goto(`${B}/episodes/142/session?take=${take}`); await page.waitForSelector('[data-step-tab]');

// Phone
await page.setViewportSize({ width: 390, height: 844 });
for (const id of ['edit', 'noise', 'tone', 'loud', 'export']) {
  await page.click(`[data-step-tab="${id}"]`); await page.waitForTimeout(700);
  ok(`phone ${id}: no sideways scroll`, !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll('[data-step-page] *')].some((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible' && e.getBoundingClientRect().right > innerWidth + 1))));
  await page.screenshot({ path: `${D}/phone-${id}.png` });
}
await page.click('[data-export]');
await page.waitForSelector('[data-picker] [data-file]');
ok('phone: the picker is a bottom sheet', await page.evaluate(() => { const r = document.querySelector('[data-picker]').getBoundingClientRect(); return Math.abs(r.bottom - innerHeight) < 2 && r.width === innerWidth; }));
await page.screenshot({ path: `${D}/phone-picker.png` });
await page.keyboard.press('Escape');
// Forget saved: back to every file
await page.click('[data-export]');
await page.click('[data-forget]');
ok('Forget saved', (await page.locator('[data-quick=saved]').count()) === 0 && !(await page.isChecked('[data-remember]')));
await page.keyboard.press('Escape');
ok('forgotten on the server too', await until(async () => (await page.evaluate(async () => (await (await fetch('/api/me/settings')).json()).settings.recording.exportFiles)) === null, 5000));
ok('no page errors', !errs.length, errs.join(' | '));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
await browser.close();
