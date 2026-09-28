import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signedIn } from './testing.ts';

const meta = { id: 'edit-take', episodeId: '142', sampleRate: 48000, bitDepth: 24, samples: 48000, segments: 1 };
const project = (name = 'First') => ({ version: 1, takeId: 'edit-take', episodeId: '142', name, tracks: [], markers: [], retakes: [], pauses: [], master: {} });

test('editor projects save with revisions and reject stale writes', async () => {
  const s = await signedIn();
  try {
    assert.equal(await s.anon('/api/editor-projects/edit-take'), 401);
    await s.call('/api/takes/edit-take', { method: 'PUT', body: { meta } });
    assert.deepEqual((await s.call('/api/editor-projects/edit-take')).body, { project: null, revision: 0, updatedAt: null });
    const first = await s.call('/api/editor-projects/edit-take', { method: 'PUT', body: { project: project(), baseRevision: 0 } });
    assert.equal(first.status, 200);
    assert.equal(first.body.revision, 1);
    const stale = await s.call('/api/editor-projects/edit-take', { method: 'PUT', body: { project: project('Stale'), baseRevision: 0 } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.project.name, 'First');
    const forced = await s.call('/api/editor-projects/edit-take', { method: 'PUT', body: { project: project('Mine'), baseRevision: 0, force: true } });
    assert.equal(forced.body.revision, 2);
    assert.equal((await s.call('/api/editor-projects/edit-take')).body.project.name, 'Mine');
  } finally {
    s.done();
  }
});

test('editor projects validate take identity', async () => {
  const s = await signedIn();
  try {
    assert.equal((await s.call('/api/editor-projects/nope', { method: 'PUT', body: { project: { ...project(), takeId: 'nope' }, baseRevision: 0 } })).status, 404);
    await s.call('/api/takes/edit-take', { method: 'PUT', body: { meta } });
    assert.equal((await s.call('/api/editor-projects/edit-take', { method: 'PUT', body: { project: { ...project(), episodeId: 'wrong' }, baseRevision: 0 } })).status, 404);
    assert.equal((await s.call('/api/editor-projects/edit-take', { method: 'PUT', body: { project: { nope: true }, baseRevision: 0 } })).status, 400);
  } finally {
    s.done();
  }
});
