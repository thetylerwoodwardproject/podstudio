import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeEditorTakes, editorSessions, remoteSource } from './editor-sessions.ts';
import type { TakeMeta } from './audio/takes.ts';
const take = (id: string, time: number) => ({ id, episodeId: 'ep', startedAt: time, updatedAt: time, status: 'done', kind: 'session', channels: 1, bitDepth: 16, sampleRate: 10, segments: 3 } as TakeMeta);
test('session discovery merges local and remote copies and selects by recording date', () => {
  const old = take('old', 1), recent = take('recent', 2); old.updatedAt = 20;
  const all = mergeEditorTakes([old], [{ id: 'old', meta: old, done: true, segments: 3 }, { id: 'recent', meta: recent, done: true, segments: 3 }]);
  assert.equal(all.length, 2); assert.equal(editorSessions(all)[0].id, 'recent');
  assert.equal(all.find((t) => t.id === 'old')?.remote, undefined);
});
test('lazy source uses exact segment sizes and only fetches intersecting PCM', async () => {
  const original = globalThis.fetch; const calls: string[] = [];
  globalThis.fetch = (async (url) => { calls.push(String(url)); return new Response(new Uint8Array(20)); }) as typeof fetch;
  try {
    const source = remoteSource(take('remote', 1), [20, 20, 20]);
    assert.equal((await source.read(1.2, .5)).length, 5);
    await source.read(1.3, .2);
    assert.equal(calls.length, 1); assert.ok(calls[0].endsWith('/segments/2'));
  } finally { globalThis.fetch = original; }
});
test('older completed full takes remain directly editable', () => {
  const old = { ...take('old-full', 1), kind: 'full' as const };
  assert.equal(editorSessions([old])[0].id, 'old-full');
});
