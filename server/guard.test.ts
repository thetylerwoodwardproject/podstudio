import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPage, redirectFor } from './guard.ts';

const nobody = { user: null, verified: false, needsSetup: false };
const halfway = { user: { id: 1, username: 'tyler', totp: true }, verified: false, needsSetup: false };
const no2fa = { user: { id: 1, username: 'tyler', totp: false }, verified: true, needsSetup: false };
const signedIn = { user: { id: 1, username: 'tyler', totp: true }, verified: true, needsSetup: false };
const fresh = { user: null, verified: false, needsSetup: true };

test('pages, not files', () => {
  assert.ok(isPage('GET', '/episodes/142/recording'));
  assert.ok(!isPage('GET', '/_astro/x.js'));
  assert.ok(!isPage('GET', '/worklets/recorder.js'));
  assert.ok(!isPage('GET', '/api/health'));
  assert.ok(!isPage('POST', '/episodes'));
});

test('first run goes to the admin account step', () => {
  assert.equal(redirectFor('/', fresh), '/setup/account');
  assert.equal(redirectFor('/setup/account', fresh), null);
  assert.equal(redirectFor('/join', fresh), null);
});

test('signed out goes to sign in, and comes back after', () => {
  assert.equal(redirectFor('/', nobody), '/signin');
  assert.equal(redirectFor('/episodes/142/studio', nobody, '?x=1'), '/signin?next=%2Fepisodes%2F142%2Fstudio%3Fx%3D1');
  assert.equal(redirectFor('/signin', nobody), null);
  assert.equal(redirectFor('/setup/account', nobody), '/signin', 'setup is over');
  for (const p of ['/join', '/guest', '/producer', '/unsupported']) assert.equal(redirectFor(p, nobody), null, p);
});

test('halfway through sign-in: only the code page', () => {
  assert.equal(redirectFor('/', halfway), '/signin/verify');
  assert.equal(redirectFor('/signin/verify', halfway), null);
  assert.equal(redirectFor('/signin', halfway), '/signin/verify');
});

test('two-factor is required before anything else', () => {
  assert.equal(redirectFor('/', no2fa), '/setup/two-factor');
  assert.equal(redirectFor('/setup/two-factor', no2fa), null);
  assert.equal(redirectFor('/settings/general', no2fa), '/setup/two-factor');
});

test('signed in: everything, and sign-in pages move on', () => {
  assert.equal(redirectFor('/episodes/142/recording', signedIn), null);
  assert.equal(redirectFor('/setup/two-factor', signedIn), null, 'reset from Settings');
  assert.equal(redirectFor('/signin', signedIn), '/');
  assert.equal(redirectFor('/signin/verify', signedIn), '/');
});
