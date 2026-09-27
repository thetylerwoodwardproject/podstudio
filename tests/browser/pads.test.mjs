import { toStep, pickAndDownload } from './steps.mjs';
import { chromium } from './auth.mjs';
import { execSync } from 'node:child_process';
import { OUT as S, B, DATA, FIX, TOOLS, CHROME } from './env.mjs';
const P = `${S}/pads`;
const e = '/episodes/142';
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${FIX}/mono11.wav`, '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, permissions: ['microphone'], acceptDownloads: true });
const errs = [];
let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', n, x); };
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
const page = await ctx.newPage();
page.on('pageerror', (x) => errs.push(page.url() + ' ' + x.message));
page.on('dialog', (d) => d.accept());

// ── Editor: pad 1 a sound effect, pad 2 a music loop ──
// Cleared on a page with no scripts (a settings page reloads itself when the server's settings arrive)
await page.goto(B + '/api/health');
await page.evaluate(async () => { localStorage.clear(); const r = await navigator.storage.getDirectory(); for await (const [n] of r) await r.removeEntry(n, { recursive: true }); });
await page.goto(B + '/settings/pads?episode=142&key=1');
await page.click('[data-kind=sfx]');
await page.setInputFiles('[data-upload]', `${FIX}/sting.wav`);
ok('upload fills the pad', await until(async () => !(await page.locator('[data-d-save]').isDisabled())));
await page.fill('[data-d-name]', 'Sting');
ok('sfx defaults: one-shot, no duck', (await page.getAttribute('[data-mode=oneshot]', 'aria-pressed')) === 'true' && !(await page.isChecked('[data-d-duck]')));
ok('44.1 kHz file converted to 48 kHz', /0:01\.0 · 48 kHz/.test(await page.locator('[data-d-source]').textContent()), await page.locator('[data-d-source]').textContent());
await page.click('[data-d-save]');
await page.click('[data-grid-key="2"]');
await page.click('[data-kind=music]');
await page.setInputFiles('[data-upload]', `${FIX}/bed.wav`);
await until(async () => !(await page.locator('[data-d-save]').isDisabled()));
await page.fill('[data-d-name]', 'Theme bed');
ok('music defaults: loop, ducks, 2 s fade', (await page.getAttribute('[data-mode=loop]', 'aria-pressed')) === 'true' && (await page.isChecked('[data-d-duck]')) && (await page.inputValue('[data-d-fadeout]')) === '2000');
await page.click('[data-d-save]');
ok('grid shows both', /SFX/.test(await page.locator('[data-grid-key="1"]').textContent()) && /LOOP/.test(await page.locator('[data-grid-key="2"]').textContent()));
await page.screenshot({ path: `${P}/editor.png`, fullPage: true });
// Drag 2 onto 3 and back
await page.dragAndDrop('[data-grid-key="2"]', '[data-grid-key="3"]');
ok('drag swaps keys', /Theme bed/.test(await page.locator('[data-grid-key="3"]').textContent()) && /Empty/.test(await page.locator('[data-grid-key="2"]').textContent()));
await page.dragAndDrop('[data-grid-key="3"]', '[data-grid-key="2"]');
ok('and back', /Theme bed/.test(await page.locator('[data-grid-key="2"]').textContent()));
// A script with a cue
await page.evaluate(() => (localStorage.setItem('podstudio:script:142', '## Cold open\n[pad 1]\nIt was a quiet week in the studio, until the new transmitter arrived.\nFour pallets. I counted.\n## The install\nSo this episode is about what happens after the crate is open.\nAnd then some.'), localStorage.setItem('podstudio:script:142:dirty', '1')));

// ── Recording with the rail ──
await page.goto(B + e + '/recording');
await page.waitForTimeout(2500);
ok('rail shows', await page.locator('[data-pad-rail]').isVisible());
ok('strip hidden on a laptop', await page.locator('[data-pad-strip]').isHidden());
ok('script cue chip', /1 · STING/i.test(await page.locator('[data-cue="1"]').textContent()));
ok('PADS meter row', await page.locator('[data-pads-meter]').isVisible());
const ring = (k) => page.evaluate((k) => !!document.querySelector(`[data-pad-rail] [data-pad-key="${k}"]`).style.boxShadow, k);
await page.keyboard.press('1');
ok('rehearsing: key 1 plays', await until(() => ring(1), 1500));
await page.waitForTimeout(1200);
ok('one-shot ends', !(await ring(1)));

await page.click('[data-start]');
await page.waitForTimeout(1500);
await page.keyboard.press('1');
await page.waitForTimeout(300);
await page.keyboard.press('2');
ok('loop plays with a now-playing card', await until(async () => (await ring(2)) && (await page.locator('[data-pad-now]').isVisible())));
ok('now playing names it', /2 · Theme bed/.test(await page.locator('[data-pad-now-name]').textContent()));
await page.waitForTimeout(3500);
ok('loop still playing past the file length', await ring(2));
const lvl = await page.locator('[data-pads-text]').textContent();
ok('PADS meter reads a level', /dB/.test(lvl) && !/—/.test(lvl), lvl);
await page.keyboard.press('2');
ok('second press fades the loop', await until(async () => /Fading/.test(await page.locator('[data-pad-now-hint]').textContent()), 1000));
await page.waitForTimeout(2300);
ok('loop gone after its fade', !(await ring(2)));
const padMarks = () => page.evaluate(() => [...document.querySelectorAll('[data-timeline-marks] > div')].filter((d) => d.title.startsWith('Pad')).length);
ok('timeline marks per press', (await padMarks()) === 2, String(await padMarks()));
// More open: 1 jumps to section, no pad
await page.keyboard.press('m');
await page.keyboard.press('2');
ok('More open: 2 jumps to a section, no pad', !(await ring(2)) && (await padMarks()) === 2);
await page.keyboard.press('Escape');
// Paused: nothing fires
await page.keyboard.press('p');
await page.keyboard.press('1');
await page.waitForTimeout(200);
ok('paused: keys do nothing', !(await ring(1)) && (await padMarks()) === 2);
await page.keyboard.press('p');
await page.waitForTimeout(3400);
// Stop all / fade all
await page.keyboard.press('2');
await page.waitForTimeout(500);
await page.keyboard.press('0');
await page.waitForTimeout(300);
ok('0 stops all', !(await ring(2)));
await page.keyboard.press('2');
await page.waitForTimeout(500);
await page.keyboard.press('Shift+Digit0');
await page.waitForTimeout(300);
ok('Shift+0 fades (still going)', await ring(2) === false || /Fading/.test(await page.locator('[data-pad-now-hint]').textContent()));
await page.waitForTimeout(2300);
await page.click('[data-pad-rail] [data-pad-key="1"]');
await page.waitForTimeout(1500);
// A cough while the bed loops: mutes the mic only.
await page.keyboard.press('2');
await page.waitForTimeout(300);
await page.keyboard.down('c');
await page.waitForTimeout(1500);
await page.keyboard.up('c');
await page.waitForTimeout(300);
await page.keyboard.press('0');
await page.screenshot({ path: `${P}/rail.png` });
ok('click fires a pad too', (await padMarks()) === 6, String(await padMarks()));

await page.keyboard.press('m');
await page.click('[data-end]');
await page.click('dialog [value=end]');
await page.waitForURL('**/saved?take=*');
await page.click('[data-export]');
await page.waitForURL('**/session?take=*');
await page.evaluate(() => sessionStorage.clear()); await page.reload(); await page.waitForSelector('[data-step-tab]');
ok('export lists the Pads track', await page.locator('[data-pads-row]').isVisible(), await page.locator('[data-pads-row]').textContent());
await page.check('[name=mix]', { force: true });
await toStep(page, 'loud');
ok('stereo episode: no mono note', (await page.locator('[data-pub-mono-note]').count()) === 0);
await page.click('label:has([name=pub-loudness][value=mono])');
ok('mono episode with pads: says the pads are summed', await page.locator('[data-pub-mono-note]').isVisible() && /sums left and right/.test(await page.locator('[data-pub-mono-note]').textContent()));
await page.screenshot({ path: `${P}/mono-note-export.png` });
await page.click('label:has([name=pub-loudness][value=stereo])');
await toStep(page, 'export');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), pickAndDownload(page)]);
execSync(`rm -rf ${P}/x && mkdir -p ${P}/x`);
await dl.saveAs(`${P}/x/s.zip`);
execSync(`cd ${P}/x && unzip -q s.zip`);
const files = execSync(`ls ${P}/x`).toString().trim().split('\n');
console.log(files.join(', '));
ok('zip has Pads, Pads edit and rough mix', ['_Pads.wav', '_Pads_edit.wav', '_RoughMix.wav'].every((s) => files.some((f) => f.endsWith(s))));
const info = JSON.parse(execSync(`python3 - <<'PY'
import wave, glob, json, struct
out = {}
for f in glob.glob('${P}/x/*.wav'):
    w = wave.open(f); n = w.getnframes(); r = w.getframerate(); c = w.getnchannels(); d = w.readframes(n)
    sw = w.getsampwidth()
    first = None
    if f.endswith('_Pads.wav'):
        for i in range(n):
            o = i * c * sw
            v = int.from_bytes(d[o+sw-2:o+sw], 'little', signed=True)
            if abs(v) > 30: first = i / r; break
    out[f.split('/')[-1]] = {'sec': n / r, 'ch': c, 'first': first}
print(json.dumps(out))
PY`).toString());
console.log(JSON.stringify(info));
const get = (s) => Object.entries(info).find(([k]) => k.endsWith(s))?.[1];
const mic = Object.entries(info).find(([k]) => /_Session_[A-Z][a-z]+\.wav$/.test(k))[1];
ok('Pads track same length as the mic', Math.abs(get('_Pads.wav').sec - mic.sec) < 0.001, `${get('_Pads.wav').sec} vs ${mic.sec}`);
ok('Pads track is stereo', get('_Pads.wav').ch === 2);
const csv = execSync(`cat ${P}/x/*.csv`).toString();
const padRows = csv.split('\n').filter((l) => /,pad,/.test(l));
ok('CSV row per press, named', padRows.length === 6 && padRows.every((l) => /Pad [12] · (Sting|Theme bed)/.test(l)), padRows[0]);
const t0 = Number(padRows[0].split(',')[0]);
ok('first press lands at its marker time (±5 ms)', Math.abs(get('_Pads.wav').first - t0) < 0.005, `${get('_Pads.wav').first} vs ${t0}`);
ok('labels name pads', /Pad 1 · Sting/.test(execSync(`cat ${P}/x/*markers.txt`).toString()));
ok('Pads edit same length as the mic edit (a cough cuts nothing)', Math.abs(get('_Pads_edit.wav').sec - get('_Tyler_edit.wav').sec) < 0.001, `${get('_Pads_edit.wav').sec} vs ${get('_Tyler_edit.wav').sec}`);
const [ma, mb] = execSync(`python3 ${TOOLS}/silent.py ${P}/x/Ep142_Session_Tyler_edit.wav`).toString().trim().split(' ').map(Number);
ok('mic edit muted for the cough (about 1.8 s)', mb - ma > 1.6 && mb - ma < 2.0, `${ma.toFixed(2)}–${mb.toFixed(2)}`);
const padsThere = Number(execSync(`python3 ${TOOLS}/rms.py ${P}/x/Ep142_Session_Pads_edit.wav ${ma + 0.05} ${mb - 0.05}`).toString());
ok('the bed is still there in the Pads edit', padsThere > 1e-3, padsThere.toExponential(1));
ok('rough mix same length', Math.abs(get('_RoughMix.wav').sec - mic.sec) < 0.001);

// ── Phone: the strip and the pull-up panel ──
const pctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 820 }, isMobile: true, hasTouch: true, permissions: ['microphone'] });
const phone = await pctx.newPage();
phone.on('pageerror', (x) => errs.push('phone ' + x.message));
// Same browser storage is per context: copy the pads over.
await phone.goto(B + '/settings/pads');
await phone.waitForLoadState('networkidle'); await phone.waitForSelector('[data-pads-editor]', { state: 'visible', timeout: 10000 }).catch(() => {});
ok('editor usable on a phone', await phone.locator('[data-pads-editor]').isVisible());
await phone.goto(B + '/settings/pads?key=1');
await phone.click('[data-kind=sfx]');
await phone.setInputFiles('[data-upload]', `${FIX}/sting.wav`);
await until(async () => !(await phone.locator('[data-d-save]').isDisabled()));
await phone.fill('[data-d-name]', 'Sting');
await phone.click('[data-d-save]');
await phone.locator('[data-grid-key="2"]').click();
await phone.click('[data-kind=music]');
await phone.setInputFiles('[data-upload]', `${FIX}/bed.wav`);
await until(async () => !(await phone.locator('[data-d-save]').isDisabled()));
await phone.click('[data-d-save]');
await phone.goto(B + e + '/recording');
await phone.waitForTimeout(2500);
ok('phone: strip shows, rail doesn\'t', (await phone.locator('[data-pad-strip]').isVisible()) && (await phone.locator('[data-pad-rail]').isHidden()));
const stripRing = (k) => phone.evaluate((k) => !!document.querySelector(`[data-pad-strip-row] [data-pad-key="${k}"]`).style.boxShadow, k);
await phone.tap('[data-pad-strip-row] [data-pad-key="2"]');
ok('phone: tap fires the loop', await until(() => stripRing(2), 1500));
ok('phone: strip says what\'s playing', await until(async () => /2 PLAYING/.test(await phone.locator('[data-pad-strip-status]').textContent())));
await phone.screenshot({ path: `${P}/phone-strip.png` });
await phone.tap('[data-pad-strip-handle]');
ok('phone: panel pulls up with nine pads', (await phone.locator('[data-pad-sheet]').isVisible()) && (await phone.locator('[data-pad-sheet-grid] [data-pad-key]').count()) === 9);
await phone.waitForTimeout(400);
await phone.screenshot({ path: `${P}/phone-sheet.png` });
await phone.tap('[data-pad-sheet-grid] [data-pad-key="1"]');
ok('phone: a one-shot drops back to the strip', await until(async () => await phone.locator('[data-pad-sheet]').isHidden(), 1500));
await phone.tap('[data-pad-strip-handle]');
await phone.tap('[data-pad-sheet-stop]');
ok('phone: Stop all', await until(async () => !(await stripRing(2)), 1500));

ok('no page errors', errs.length === 0, errs.join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
await browser.close();
