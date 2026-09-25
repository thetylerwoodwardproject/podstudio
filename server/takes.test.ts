import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signedIn } from './testing.ts';

const meta = (extra = {}) => ({ id: 't1', episodeId: '142', sampleRate: 48000, bitDepth: 24, channels: 1, segments: 0, ...extra });

test('a take: meta first, then its segments, then done', async () => {
  const s = await signedIn();
  try {
    assert.equal(await s.anon('/api/takes/t1'), 401, 'needs sign-in');
    assert.equal((await s.call('/api/takes/t1/segments/1', { method: 'PUT', raw: Buffer.alloc(10, 1) })).status, 404, 'meta first');
    assert.equal((await s.call('/api/takes/t1', { method: 'PUT', body: { meta: meta() } })).status, 200);
    for (const n of [1, 2]) assert.equal((await s.call(`/api/takes/t1/segments/${n}`, { method: 'PUT', raw: Buffer.alloc(30, n) })).body.segments, n);
    assert.equal((await s.call('/api/takes/t1/segments/3', { method: 'PUT', raw: Buffer.alloc(0) })).status, 400, 'never empty');
    assert.deepEqual((await s.call('/api/takes/t1/segments/2')).buf, Buffer.alloc(30, 2));
    await s.call('/api/takes/t1', { method: 'PUT', body: { meta: meta({ segments: 2, status: 'done' }), done: true } });
    const one = (await s.call('/api/takes/t1')).body;
    assert.equal(one.segments, 2);
    assert.equal(one.done, true);
    const list = (await s.call('/api/takes?episode=142')).body.takes;
    assert.deepEqual(list.map((t: { id: string }) => t.id), ['t1']);
    assert.equal((await s.call('/api/episodes')).body.episodes[0].sessions, 1, 'counted on the home page');
    await s.call('/api/takes/t1', { method: 'DELETE' });
    assert.equal((await s.call('/api/takes/t1')).status, 404);
  } finally {
    s.done();
  }
});

test('bad ids and meta are refused', async () => {
  const s = await signedIn();
  try {
    assert.equal((await s.call('/api/takes/..%2Fx', { method: 'PUT', body: { meta: meta() } })).status, 404);
    assert.equal((await s.call('/api/takes/t2', { method: 'PUT', body: { meta: { nope: 1 } } })).status, 400);
    await s.call('/api/takes/t2', { method: 'PUT', body: { meta: meta({ id: 't2' }) } });
    assert.equal((await s.call('/api/takes/t2/segments/0', { method: 'PUT', raw: Buffer.alloc(4, 1) })).status, 400);
  } finally {
    s.done();
  }
});
