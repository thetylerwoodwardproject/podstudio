import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32Decode, base32Encode, hashPassword, newRecoveryCodes, newTotpSecret, passwordProblem, totpAt, verifyPassword, verifyTotp } from './auth.ts';

test('TOTP matches the RFC 6238 test vectors (SHA-1)', () => {
  const secret = Buffer.from('12345678901234567890');
  const at = (t: number) => totpAt(secret, Math.floor(t / 30), 8);
  assert.equal(at(59), '94287082');
  assert.equal(at(1111111109), '07081804');
  assert.equal(at(1111111111), '14050471');
  assert.equal(at(1234567890), '89005924');
  assert.equal(at(2000000000), '69279037');
  assert.equal(at(20000000000), '65353130');
});

test('base32 round trip, as authenticator apps read it', () => {
  const b = Buffer.from('12345678901234567890');
  assert.equal(base32Encode(b), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq'), b);
  assert.equal(newTotpSecret().length, 32);
});

test('a code is good for its step and one either side, and only once', () => {
  const secret = newTotpSecret();
  const now = 1_790_000_000_000;
  const step = Math.floor(now / 30000);
  const code = totpAt(base32Decode(secret), step);
  assert.equal(verifyTotp(secret, code, now), step);
  assert.equal(verifyTotp(secret, code, now + 30000), step, 'a step late is fine');
  assert.equal(verifyTotp(secret, code, now + 90000), null, 'too late');
  assert.equal(verifyTotp(secret, code, now, step), null, 'already used');
  assert.equal(verifyTotp(secret, '12345', now), null);
});

test('passwords hash with scrypt and verify', async () => {
  const h = await hashPassword('transmitter-2026');
  assert.match(h, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verifyPassword('transmitter-2026', h), true);
  assert.equal(await verifyPassword('transmitter-2025', h), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
  assert.notEqual(await hashPassword('same'), await hashPassword('same'), 'salted');
  assert.equal(passwordProblem('short'), 'Use at least 10 characters');
  assert.equal(passwordProblem('long enough now'), null);
});

test('recovery codes look like k7m2-xq4p and are all different', () => {
  const codes = newRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.ok(codes.every((c) => /^[a-z2-9]{4}-[a-z2-9]{4}$/.test(c)));
  assert.equal(new Set(codes).size, 10);
});
