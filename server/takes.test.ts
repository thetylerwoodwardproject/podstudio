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

test('completed legacy guest uploads are discoverable as read-only take sources', async () => {
  const s = await signedIn();
  try {
    const room = (await s.call('/api/sessions', { body: { episodeId: '142' } })).body;
    const guest = (await s.call('/api/join', { body: { code: room.codes.guest, name: 'Sam' } })).body;
    s.ctx.live.admit(room.sessionId, s.ctx.live.member(room.sessionId, guest.token)!.id);
    const path = `/api/sessions/${room.sessionId}/tracks/guest`;
    const query = `?token=${guest.token}`;
    const pcm = Buffer.alloc(480, 2);
    assert.equal((await s.call(`${path}/segments/1${query}`, { method: 'PUT', raw: pcm })).status, 204);
    await s.call(`${path}/meta${query}`, { method: 'PUT', body: { name: 'Sam', sampleRate: 48000, bitDepth: 16, channels: 1, segments: 1, done: true } });
    await s.call('/api/takes/t1', { method: 'PUT', body: { meta: meta({ group: 'g1', guest: { name: 'Sam', sessionId: room.sessionId } }), done: true } });
    const list = (await s.call('/api/takes?episode=142')).body.takes;
    const source = list.find((t: { id: string }) => t.id === 't1-guest');
    assert.equal(source.meta.samples, 240);
    assert.equal(source.meta.group, 'g1');
    assert.equal(source.meta.guest, undefined);
    assert.deepEqual((await s.call('/api/takes/t1-guest')).body.segmentBytes, [480]);
    assert.deepEqual((await s.call('/api/takes/t1-guest/segments/1')).buf, pcm);
    assert.equal(await s.anon('/api/takes/t1-guest/segments/1'), 401);
    assert.equal((await s.call('/api/takes/t1-guest/segments/1', { method: 'PUT', raw: pcm })).status, 404);
    await s.call('/api/takes/t1', { method: 'PUT', body: { meta: meta({ episodeId: 'another', guest: { sessionId: room.sessionId } }), done: true } });
    assert.equal((await s.call('/api/takes/t1-guest')).status, 404, 'a session must belong to the host episode');
  } finally { s.done(); }
});
