import { toStep, throughWrap, pickAndDownload, resetSettings } from './steps.mjs';
import { chromium } from './auth.mjs';
import { execSync } from 'node:child_process';
import { OUT as S, B, DATA, FIX, TOOLS, CHROME } from './env.mjs';
const launch = (wav) => chromium.launch({ executablePath: CHROME,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
const hostB = await launch(`${FIX}/mono11.wav`);
const guestB = await launch(`${FIX}/noisy-guest.wav`);
const ctx = (b, extra = {}) => b.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone'], acceptDownloads: true, viewport: { width: 1300, height: 850 }, ...extra });
const errs = [];
const watch = (p, who) => { p.on('pageerror', (e) => errs.push(`${who}: ${e.message}`)); p.on('dialog', (d) => d.accept()); return p; };
let fails = 0; const ok = (n, c, x = '') => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', n, x); };
const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };

// Host sets up the show
const host = watch(await (await ctx(hostB)).newPage(), 'host');
await host.goto(B + '/episodes/142/studio');
await resetSettings(host, () => ({}), { clear: true });
await host.reload();
await host.click('label:has-text("With a guest")');
await host.click('label:has-text("Speaker lines")');
await host.click('label:has([name=producer])');
await until(async () => /\d{3} \d{3}/.test(await host.locator('[data-code-row=producer] [data-code]').textContent()));
const guestCode = (await host.locator('[data-code-row=guest] [data-code]').textContent()).replace(/\D/g, '');
const producerCode = (await host.locator('[data-code-row=producer] [data-code]').textContent()).replace(/\D/g, '');
ok('two 6-digit codes', /^\d{6}$/.test(guestCode) && /^\d{6}$/.test(producerCode), `${guestCode} ${producerCode}`);
// Line 2 is the guest's
await host.goto(B + '/episodes/142/script');
await host.locator('[data-script-lines] button').nth(1).click();
await host.waitForTimeout(600);
await host.goto(B + '/episodes/142/recording?legacy=1');
await host.waitForTimeout(1500);

// Guest joins with the code, on another browser
const guestCtx = await ctx(guestB, { viewport: { width: 390, height: 820 }, isMobile: true, hasTouch: true });
// The guest's clock runs 0.1 % slow (1000 ppm, far beyond any real device): its audio looks fast against it.
await guestCtx.addInitScript(() => { const real = Date.now; const t0 = real(); Date.now = () => Math.round(t0 + (real() - t0) * (1 - 0.001)); });
const guest = watch(await guestCtx.newPage(), 'guest');
await guest.goto(`${B}/join?code=${guestCode}`);
await guest.fill('[data-name]', 'Sam');
await guest.click('[data-join-btn]');
await guest.waitForURL('**/guest');
ok('guest code opens the green room', await until(async () => (await guest.locator('#guest').getAttribute('data-stage')) === 'green'));
ok('guest waits to be let in', await until(async () => (await guest.locator('[data-lobby]').isVisible()) && (await guest.locator('[data-join]').isDisabled())));
ok('nothing about the show reaches them yet', !/Tyler/.test(await guest.locator('[data-host-name]').textContent()));
ok('host is asked', await until(async () => /Sam wants to join as your guest/.test(await host.locator('[data-knock]').first().textContent() ?? '')));
await host.screenshot({ path: `${S}/guest/knock.png` });
await host.locator('[data-knock] [data-admit]').first().click();
ok('let in', await until(async () => !(await guest.locator('[data-join]').isDisabled())));
ok('green room names the host', await until(async () => /Tyler/.test(await guest.locator('[data-host-name]').textContent())));
await guest.click('label:has([name=ready])');
await guest.click('[data-join]');
ok('guest waits for the host', await until(async () => (await guest.locator('#guest').getAttribute('data-stage')) === 'waiting') && /Waiting for Tyler/.test(await guest.locator('[data-banner-body]').textContent()));
ok('guest sees their line highlighted', /YOU/.test(await guest.locator('[data-track]').textContent()));
console.log('GUEST VIEW waiting', JSON.stringify(await guest.evaluate(() => { const v = document.querySelector('[data-viewport]'); const t = document.querySelector('[data-track]'); return { hidden: v.hidden, vh: v.clientHeight, th: t.offsetHeight, tf: t.style.transform }; })));
await guest.screenshot({ path: `${S}/guest/guest-wait.png` });

// Someone else with the guest code (a bot) is turned away
const g2 = watch(await (await ctx(guestB)).newPage(), 'bot');
await g2.goto(`${B}/join?code=${guestCode}`);
await g2.fill('[data-name]', 'bot');
await g2.click('[data-join-btn]');
await g2.waitForURL('**/guest');
ok('host is asked about the bot', await until(async () => /bot wants to join/.test(await host.locator('[data-knock]').first().textContent() ?? '')));
await host.locator('[data-knock] [data-deny]').first().click();
ok('bot is turned away', await until(async () => /didn’t let you in/.test(await g2.locator('[data-msg-title]').textContent())), await g2.locator('[data-msg-title]').textContent());
await g2.close();

// Producer joins
const prod = watch(await (await ctx(hostB)).newPage(), 'producer');
await prod.goto(`${B}/join?code=${producerCode}`);
await prod.fill('[data-name]', 'Pat');
await prod.click('[data-join-btn]');
await prod.waitForURL('**/producer');
ok('producer waits to be let in', await until(async () => /Waiting for the host to let you in/.test(await prod.locator('[data-lines]').textContent())));
await host.locator('[data-knock] [data-admit]').first().click();
ok('producer sees the script', await until(async () => (await prod.locator('[data-lines] [data-line]').count()) > 5));
ok('producer sees the guest', await until(async () => /Sam/.test(await prod.locator('[data-guest-name]').textContent())));
ok('host sees the guest chip', await until(async () => /Sam/.test(await host.locator('[data-guest-name]').textContent())));

// Producer starts the session
await prod.click('[data-cmd=start]');
ok('host is recording', await until(async () => (await host.locator('#recording').getAttribute('data-state')) === 'rec'));
ok('guest is recording', await until(async () => (await guest.locator('#guest').getAttribute('data-stage')) === 'rec'));
await host.waitForTimeout(4000);
await prod.click('[data-cmd=retake]');
ok('producer retake lands on the host', await until(async () => /retake/.test(await prod.locator('[data-counts]').textContent())), await prod.locator('[data-counts]').textContent());
// Producer edits line 4
const line = prod.locator('[data-lines] [data-line="3"] [contenteditable]');
await line.click();
await prod.keyboard.press('End');
await prod.keyboard.type(' EDITED');
await prod.waitForTimeout(1500);
ok('edit reaches the host', await until(async () => /EDITED/.test(await host.locator('[data-track]').textContent())));
ok('edit reaches the guest', await until(async () => /EDITED/.test(await guest.locator('[data-track]').textContent())));
await prod.locator('[data-cmd=next]').click();
ok('producer moves the reader', await until(async () => Number(await host.evaluate(() => document.querySelector('[data-track] [data-l=now]')?.dataset.line)) >= 1));
// Guest cough → mutes the guest's track only
const box = await guest.locator('[data-cough]').boundingBox();
await guest.dispatchEvent('[data-cough]', 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: box.x + 5, clientY: box.y + 5 });
await guest.waitForTimeout(800);
await guest.dispatchEvent('[data-cough]', 'pointerup', { pointerId: 1, pointerType: 'touch' });
ok('guest cough is marked on the host', await until(async () => /cough/.test(await prod.locator('[data-counts]').textContent())), await prod.locator('[data-counts]').textContent());
ok('producer has no cough or cut button', (await prod.locator('[data-cmd=cut]').count()) === 0);
await host.waitForTimeout(45000); // long enough for the drift to be measurable
ok('guest uploads while recording', /Sent [1-9]/.test(await guest.locator('[data-upload]').textContent()), await guest.locator('[data-upload]').textContent());
const gv = await guest.evaluate(() => { const v = document.querySelector('[data-viewport]'); const now = document.querySelector('[data-track] [data-l=now]'); const r = now?.getBoundingClientRect(); return { vh: v.clientHeight, top: r?.top, winH: innerHeight }; });
ok('guest sees the current line on screen', gv.vh < gv.winH && gv.top > 0 && gv.top < gv.winH, JSON.stringify(gv));
const whoCol = await prod.locator('[data-lines] [data-line] button').allTextContents();
ok('host lines stay HOST after a guest line', whoCol[0] === 'HOST' && whoCol[1] === 'GUEST' && whoCol[2] === 'HOST' && whoCol[3] === 'HOST', whoCol.slice(0, 5).join(','));
await host.screenshot({ path: `${S}/guest/host-rec.png` });
await prod.screenshot({ path: `${S}/guest/producer.png` });
await guest.screenshot({ path: `${S}/guest/guest-rec.png` });

// Producer ends it
await prod.click('[data-cmd=stop]');
await host.waitForURL('**/wrap?take=*', { timeout: 20000 });
ok('guest sends the last pieces', await until(async () => /All sent/.test(await guest.locator('[data-banner-title]').textContent()), 30000), await guest.locator('[data-banner-title]').textContent());
ok('wrap-up brings in the guest track', await throughWrap(host, until));
await host.waitForURL('**/export-legacy?take=*');
await toStep(host, 'export');
const [dl] = await Promise.all([host.waitForEvent('download'), pickAndDownload(host)]);
await dl.saveAs(`${S}/guest/x.zip`);
execSync(`rm -rf ${S}/guest/x && mkdir -p ${S}/guest/x && cd ${S}/guest/x && unzip -q ../x.zip`);
const files = execSync(`ls ${S}/guest/x`).toString().trim().split('\n');
// Sync: a report, and timecode in every WAV.
const report = execSync(`cat ${S}/guest/x/*_export.txt`).toString();
console.log(report);
const ppm = Number((report.match(/\(([+−-]\d+) ppm\)/) ?? [])[1]?.replace('−', '-'));
// Expected: each track's rate against the shared clock, from its raw sync points (plain least squares).
const expected = Number(execSync(`python3 -c "
import json,glob,os
def ppm(f):
    m=json.load(open(f)); p=m['sync']['points']; r=m['sampleRate']
    n=len(p); fm=sum(x[0] for x in p)/n; tm=sum(x[1] for x in p)/n
    k=sum((x[0]-fm)*(x[1]-tm) for x in p)/sum((x[0]-fm)**2 for x in p)
    return k*r/1000
g=max(glob.glob('${DATA}/live/*/guest/meta.json'), key=os.path.getmtime)
h=max(glob.glob('${DATA}/takes/*/meta.json'), key=os.path.getmtime)
print((ppm(h)/ppm(g)-1)*1e6)
"`).toString());
ok('sync report measures the guest against the host as the raw points say', Math.abs(ppm - expected) < 300, `${ppm} vs ${Math.round(expected)} ppm`);
ok('including the 1000 ppm the guest clock was skewed', ppm > 700, String(ppm));
ok('sync report has the timecode', /Timecode .*: \d\d:\d\d:\d\d:\d\d/.test(report));
const bextInfo = execSync(`cd ${S}/guest/x && python3 -c "
import glob,struct
for f in sorted(glob.glob('*.wav')):
    b=open(f,'rb').read(); i=b.find(b'bext')
    if i<0: print(f,'NO-BEXT'); continue
    lo,hi=struct.unpack('<II',b[i+8+338:i+8+346]); print(f, lo+hi*2**32)
"`).toString();
console.log(bextInfo);
ok('every WAV has timecode', !/NO-BEXT/.test(bextInfo));
const tcOf = (suffix) => Number(bextInfo.split('\n').find((l) => l.split(' ')[0].endsWith(suffix)).split(' ')[1]);
ok('host and guest raw files share a timecode', tcOf('_Tyler.wav') === tcOf('_Sam.wav'));
ok('host and guest edits share a timecode', tcOf('_Tyler_edit.wav') === tcOf('_Sam_edit.wav'));
ok('the export page says what it corrected', /ms of drift corrected/.test(await host.locator('[data-sync-note]').textContent()), await host.locator('[data-sync-note]').textContent());
ok('zip has both tracks and both edits', ['_Tyler.wav', '_Sam.wav', '_Tyler_edit.wav', '_Sam_edit.wav'].every((x) => files.some((f) => f.endsWith(x))), files.join(', '));
console.log(execSync(`cd ${S}/guest/x && python3 -c "
import wave,glob
for f in sorted(glob.glob('*.wav')):
    w=wave.open(f); print(f, w.getframerate(), round(w.getnframes()/w.getframerate(),3))
"`).toString());
const len = (f) => Number(execSync(`python3 -c "import wave,glob;w=wave.open(glob.glob('${S}/guest/x/*${f}')[0]);print(w.getnframes()/w.getframerate())"`).toString());
ok('raw tracks the same length (lined up)', Math.abs(len('_Tyler.wav') - len('_Sam.wav')) < 0.01);
ok('edits the same length', Math.abs(len('_Tyler_edit.wav') - len('_Sam_edit.wav')) < 0.01);
// The guest's edit is silent across their cough; the host's edit isn't.
const csvText = execSync(`cat ${S}/guest/x/*.csv`).toString();
ok('CSV says whose cough', /,cut,.*Cough \(muted\) · Sam/.test(csvText), csvText.split('\n').filter((l) => /,cut,/.test(l))[0]);
const [sa, sb] = execSync(`python3 ${TOOLS}/silent.py ${execSync(`ls ${S}/guest/x/*_Sam_edit.wav`).toString().trim()}`).toString().trim().split(' ').map(Number);
ok('guest edit has the muted stretch (about 1.1 s)', sb - sa > 0.9 && sb - sa < 1.3, `${sa.toFixed(2)}–${sb.toFixed(2)}`);
const hostThere = Number(execSync(`python3 ${TOOLS}/rms.py ${execSync(`ls ${S}/guest/x/*_Tyler_edit.wav`).toString().trim()} ${sa + 0.05} ${sb - 0.05}`).toString());
ok('host edit not muted there', hostThere > 1e-3, hostThere.toExponential(1));
// Export stays locked while a guest's track is missing
const hostTake = new URL(host.url()).searchParams.get('take');
await host.evaluate(async (id) => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('takes'); await d.removeEntry(`${id}-guest`, { recursive: true }); }, hostTake);
await host.goto(`${B}/episodes/142/export-legacy?take=${hostTake}`);
await toStep(host, 'export');
ok('export waits for the guest', (await host.locator('[data-guest-missing]').isVisible()) && (await host.locator('[data-export]').isDisabled()), await host.locator('[data-guest-missing]').textContent());
await host.goto(`${B}/episodes/142/sessions`);
await host.waitForTimeout(1000);
ok('sessions list opens the editor', /editor\?take=/.test(await host.locator('[data-open]').first().getAttribute('href')) && /waiting for Sam/.test(await host.locator('[data-card] [data-summary]').first().textContent()));
await host.locator('[data-open]').first().click();
await host.waitForSelector('[data-editor]', { timeout: 30000 });
ok('editor reads the server-only guest track', await host.locator('[data-track]').count() >= 2);
// Keep the existing wrap-up recovery path covered for legacy sessions.
await host.goto(`${B}/episodes/142/wrap?take=${hostTake}`);
ok('wrap-up fetches it again', await throughWrap(host, until));
await host.goto(`${B}/episodes/142/export-legacy?take=${hostTake}`);
await toStep(host, 'export');
ok('then export is open', (await host.locator('[data-guest-missing]').isHidden()) && !(await host.locator('[data-export]').isDisabled()));
ok('no page errors', !errs.length, errs.join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
await hostB.close(); await guestB.close();
