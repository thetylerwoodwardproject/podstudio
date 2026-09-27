import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signedIn } from './testing.ts';

test('settings: kept on the server for the signed-in person, newest wins', async () => {
  const s = await signedIn();
  try {
    assert.equal(await s.anon('/api/me/settings'), 401, 'needs sign-in');
    const empty = (await s.call('/api/me/settings')).body;
    assert.deepEqual(empty, { settings: null, updatedAt: 0 });
    const put = await s.call('/api/me/settings', { method: 'PUT', body: { settings: { recording: { noiseSuppression: 40 } } } });
    assert.equal(put.status, 200);
    assert.ok(put.body.updatedAt > 0);
    const got = (await s.call('/api/me/settings')).body;
    assert.deepEqual(got.settings, { recording: { noiseSuppression: 40 } });
    assert.equal(got.updatedAt, put.body.updatedAt);
    // Replaced whole, not merged
    await s.call('/api/me/settings', { method: 'PUT', body: { settings: { prompter: { wpm: 170 } } } });
    assert.deepEqual((await s.call('/api/me/settings')).body.settings, { prompter: { wpm: 170 } });
    assert.equal((await s.call('/api/me/settings', { method: 'PUT', body: { settings: [1, 2] } })).status, 400);
    assert.equal((await s.call('/api/me/settings', { method: 'PUT', body: {} })).status, 400);
  } finally {
    s.done();
  }
});
