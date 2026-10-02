import { chromium, USER, PASS } from './auth.mjs';
import { chromium as rawChromium } from 'playwright-core';
import { B, CHROME } from './env.mjs';

const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
const page = await context.newPage();
let failed = 0;
const ok = (label, value) => { console.log(value ? 'PASS' : 'FAIL', label); if (!value) failed++; };

await page.goto(`${B}/join`);
await page.locator('[data-otp] input').focus();
await page.keyboard.insertText('123456');
const firstValue = await page.locator('[data-otp] input').inputValue();
const firstSlots = await page.locator('[data-slot=input-otp-slot]').allTextContents();
ok('one input fills six visible invite-code cells', firstValue === '123456' && firstSlots.length === 6 && firstSlots.map((slot) => slot.trim()).join('') === '123456');

await page.goto(`${B}/join?code=654321`);
await page.waitForFunction(() => document.querySelector('[data-otp] input')?.value === '654321');
ok('invite link fills the OTP after hydration', await page.locator('[data-otp] input').inputValue() === '654321');
ok('OTP keeps one-time-code autofill', await page.locator('[data-otp] input').getAttribute('autocomplete') === 'one-time-code');

await browser.close();

const signedOutBrowser = await rawChromium.launch({ executablePath: CHROME });
const signedOutContext = await signedOutBrowser.newContext({ ignoreHTTPSErrors: true });
const signInPage = await signedOutContext.newPage();
await signInPage.goto(`${B}/signin`);
await signInPage.getByLabel('Username').fill(USER);
await signInPage.getByLabel('Password').fill(PASS);
await signInPage.getByRole('button', { name: 'Sign in' }).click();
await signInPage.waitForURL('**/signin/verify');
await signInPage.locator('[data-otp] input').focus();
await signInPage.keyboard.insertText('12345');
ok('two-factor verification uses the six-cell OTP control',
  await signInPage.locator('[data-slot=input-otp-slot]').count() === 6 &&
  await signInPage.locator('[data-otp] input').inputValue() === '12345');
await signedOutBrowser.close();

console.log(failed ? `${failed} FAILED` : 'ALL PASS');
process.exitCode = failed ? 1 : 0;
