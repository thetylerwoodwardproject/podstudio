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
await host.check('[name=producer]');
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
const guest = watch(await (await ctx(guestB, { viewport: { width: 390, height: 820 }, isMobile: true, hasTouch: true })).newPage(), 'guest');
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
await guest.check('[name=ready]');
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
await host.waitForTimeout(8000);
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
ok('wrap-up brings in the guest track', await throughWrap(host, until, async () => {
  await host.screenshot({ path: `${S}/guest/wrap.png` });
  // Line up: Host / Guest / Both, and a nudge of +50 ms (10 presses)
  for (let i = 0; i < 10; i++) await host.click('[data-nudge="1"]');
  ok('nudge +50 ms', (await host.textContent('[data-nudge-value]')) === '+50 ms');
  await host.click('[data-play]');
  ok('line-up preview plays both', await until(async () => (await host.getAttribute('[data-play]', 'aria-label')) === 'Pause preview', 30000) && /Host \+ guest, offset \+50 ms/.test(await host.textContent('[data-chain]')), await host.textContent('[data-chain]'));
  ok('waveforms drawn', (await host.locator('[data-wave] svg').count()) === 2);
  await host.screenshot({ path: `${S}/guest/lineup.png` });
  await host.click('[data-play]');
  await host.waitForTimeout(600);
}));
await host.waitForURL('**/export-legacy?take=*');
await toStep(host, 'export');
const [dl] = await Promise.all([host.waitForEvent('download'), pickAndDownload(host)]);
await dl.saveAs(`${S}/guest/x.zip`);
execSync(`rm -rf ${S}/guest/x && mkdir -p ${S}/guest/x && cd ${S}/guest/x && unzip -q ../x.zip`);
const files = execSync(`ls ${S}/guest/x`).toString().trim().split('\n');
ok('the report says the guest was nudged', /nudged \+50 ms by hand/.test(execSync(`cat ${S}/guest/x/*_export.txt`).toString()));
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
ok('sessions list points to the wrap-up', /wrap\?take=/.test(await host.locator('[data-open]').first().getAttribute('href')) && /waiting for Sam/.test(await host.locator('[data-card] [data-summary]').first().textContent()));
await host.locator('[data-open]').first().click();
ok('wrap-up fetches it again', await throughWrap(host, until));
await host.goto(`${B}/episodes/142/export-legacy?take=${hostTake}`);
await toStep(host, 'export');
ok('then export is open', (await host.locator('[data-guest-missing]').isHidden()) && !(await host.locator('[data-export]').isDisabled()));
ok('no page errors', !errs.length, errs.join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
await hostB.close(); await guestB.close();
