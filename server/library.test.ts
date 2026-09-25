import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signedIn } from './testing.ts';

test('episodes: the example is there, new ones take the next number', async () => {
  const s = await signedIn();
  try {
    assert.equal(await s.anon('/api/episodes'), 401, 'needs sign-in');
    const list = (await s.call('/api/episodes')).body.episodes;
    assert.deepEqual(list.map((e: { id: string; label: string }) => [e.id, e.label]), [['142', 'Ep. 142']]);
    const made = (await s.call('/api/episodes', { body: { title: 'Antenna Season' } })).body.episode;
    assert.equal(made.number, 143);
    assert.equal(made.fullTitle, 'Ep. 143 — Antenna Season');
    assert.equal((await s.call(`/api/episodes/${made.id}`, { method: 'PATCH', body: { title: 'Antenna Season, Part 1' } })).body.episode.title, 'Antenna Season, Part 1');
    assert.equal((await s.call('/api/episodes/nope')).status, 404);
  } finally {
    s.done();
  }
});

test('scripts: saved with a version; a stale save is refused with the current copy', async () => {
  const s = await signedIn();
  try {
    assert.equal((await s.call('/api/episodes/142')).body.script, null, 'the example until you add your own');
    const v1 = (await s.call('/api/episodes/142/script', { method: 'PUT', body: { text: 'HOST: One.' } })).body.version;
    assert.equal(v1, 1);
    const v2 = (await s.call('/api/episodes/142/script', { method: 'PUT', body: { text: 'HOST: Two.', base: 1 } })).body.version;
    assert.equal(v2, 2);
    const stale = await s.call('/api/episodes/142/script', { method: 'PUT', body: { text: 'HOST: Old tab.', base: 1 } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.script.text, 'HOST: Two.');
    const list = (await s.call('/api/episodes')).body.episodes;
    assert.equal(list[0].words, 1);
    await s.call('/api/episodes/142/script', { method: 'DELETE' });
    assert.equal((await s.call('/api/episodes/142')).body.script, null);
  } finally {
    s.done();
  }
});

test('show setup and pads round trip; bad pad sets are refused', async () => {
  const s = await signedIn();
  try {
    await s.call('/api/episodes/142/setup', { method: 'PUT', body: { format: 'guest', mode: 'adlib' } });
    const pad = { id: 'p1', key: 3, name: 'Bite', kind: 'bite' };
    assert.equal((await s.call('/api/pads/show', { method: 'PUT', body: [pad] })).status, 200);
    assert.equal((await s.call('/api/pads/episode/142', { method: 'PUT', body: [{ ...pad, id: 'p2', name: 'Ep bite' }] })).status, 200);
    const d = (await s.call('/api/episodes/142')).body;
    assert.equal(d.setup.mode, 'adlib');
    assert.equal(d.pads.show[0].name, 'Bite');
    assert.equal(d.pads.episode[0].name, 'Ep bite');
    assert.equal((await s.call('/api/pads/show', { method: 'PUT', body: [pad, { ...pad, id: 'x' }] })).status, 400, 'two on one key');
    assert.equal((await s.call('/api/pads/show', { method: 'PUT', body: [{ ...pad, key: 12 }] })).status, 400);
  } finally {
    s.done();
  }
});

test('media: a WAV goes up and comes back; empty uploads are refused', async () => {
  const s = await signedIn();
  try {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40, 7)]);
    assert.equal((await s.call('/api/media/f1?name=Sting&seconds=1.5', { method: 'PUT', raw: wav })).status, 200);
    assert.deepEqual((await s.call('/api/media/f1')).buf, wav);
    assert.equal((await s.call('/api/media')).body.media[0].name, 'Sting');
    assert.equal((await s.call('/api/media/f2', { method: 'PUT', raw: Buffer.alloc(0) })).status, 400);
    assert.equal((await s.call('/api/media/..%2Fx', { method: 'PUT', raw: wav })).status, 404, 'no paths');
  } finally {
    s.done();
  }
});
