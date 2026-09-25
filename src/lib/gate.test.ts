import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateReason, type GateEnv } from './gate.ts';

const ok = { secure: true, worklet: true, opfs: true, mic: true, locks: true, touchPoints: 0, platform: 'Win32', chromium: true };
const iphone26 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const env = (e: Partial<GateEnv>): GateEnv => ({ ...ok, ua: 'Mozilla/5.0 Chrome/140', ...e });

test('Chrome on a computer is allowed', () => assert.equal(gateReason(env({})).reason, null));

test('plain http on a phone gets the HTTPS explanation, not "update iOS"', () => {
  const r = gateReason(env({ ua: iphone26, platform: 'iPhone', chromium: false, secure: false, worklet: false, opfs: false }));
  assert.equal(r.reason, 'insecure');
  assert.ok(r.failed.includes('secure context (https)'));
});

test('iOS 26 (user agent frozen at 18_6) is judged on features and allowed', () => {
  assert.equal(gateReason(env({ ua: iphone26, platform: 'iPhone', chromium: false })).reason, null);
});

test('an iPad in desktop mode counts as iOS', () => {
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
  assert.equal(gateReason(env({ ua, platform: 'MacIntel', touchPoints: 5, chromium: false })).reason, null);
});

test('an old WebKit without AudioWorklet is told to update', () => {
  const r = gateReason(env({ ua: iphone26, platform: 'iPhone', chromium: false, worklet: false }));
  assert.equal(r.reason, 'ios-old');
  assert.deepEqual(r.failed, ['AudioWorklet']);
});

test('Firefox and Safari on a Mac go to the browser page', () => {
  assert.equal(gateReason(env({ chromium: false, ua: 'Mozilla/5.0 Firefox/140' })).reason, 'browser');
  assert.equal(gateReason(env({ chromium: false, ua: 'Mozilla/5.0 (Macintosh) Version/26.0 Safari/605', platform: 'MacIntel' })).reason, 'browser');
});
