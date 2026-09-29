import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorProject, defaultFx, moveClip, trimClip, splitProject, deleteClip, cleanEditorProject } from './editor-project.ts';
import { crossfadeGain, crossfadeSpan } from './editor-crossfades.ts';
import { renderEditorWindow, renderProjectWav } from './audio/editor-render.ts';
import { WavReader } from './audio/master.ts';
const make = () => {
  const p = createEditorProject({ takeId: 't', episodeId: 'e', name: 'Test', sources: [{ id: 's', kind: 'import', name: 'Import', duration: 30, channels: 1, sampleRate: 1000 }] });
  const t = p.tracks[0]; t.fx = defaultFx(false);
  t.clips = [{ ...t.clips[0], id: 'a', sourceEnd: 10, linked: false }, { ...t.clips[0], id: 'b', sourceStart: 10, sourceEnd: 20, timelineStart: 10, linked: false }];
  return p;
};
const overlap = () => { const p = make(); return moveClip(p, p.tracks[0].id, 'b', 8); };
const sources = new Map([['s', { channels: 1 as const, sampleRate: 1000, read: async (_from: number, seconds: number) => new Float32Array(Math.round(seconds * 1000)).fill(.2) }]]);
test('moving creates a whole-overlap equal-power same-track crossfade', () => {
  const p = overlap(), t = p.tracks[0]; assert.equal(p.crossfades?.length, 1);
  assert.deepEqual(crossfadeSpan(t, p.crossfades![0]), [8, 10]);
  for (let at = 8; at <= 10; at += .125) assert.ok(Math.abs(crossfadeGain(t, p.crossfades!, 'a', at) ** 2 + crossfadeGain(t, p.crossfades!, 'b', at) ** 2 - 1) < 1e-12);
  assert.equal(moveClip(p, t.id, 'b', 12).crossfades?.length, 0);
  assert.deepEqual(crossfadeSpan(trimClip(p, t.id, 'a', 'end', .5).tracks[0], trimClip(p, t.id, 'a', 'end', .5).crossfades![0]), [8, 9.5]);
});
test('legacy overlaps retain their sound until edited; different tracks mix normally', async () => {
  const p = make(); p.tracks[0].clips[1].timelineStart = 8;
  const legacy = await renderEditorWindow(p, sources, 9, .1, [], 1000);
  assert.ok(Math.abs(legacy[0] - .4) < 1e-6);
  assert.equal(cleanEditorProject(p)?.crossfades?.length, 0);
  const moved = moveClip(p, p.tracks[0].id, 'b', 8.1);
  assert.equal(moved.crossfades?.length, 1);
});
test('split preserves crossfade envelope, deleting an edge removes dangling fades', async () => {
  const p = overlap(), split = splitProject(p, 9);
  const before = await renderEditorWindow(p, sources, 8, 2, [], 1000);
  const after = await renderEditorWindow(split, sources, 8, 2, [], 1000);
  assert.deepEqual(after, before);
  assert.equal(deleteClip(p, p.tracks[0].id, 'b').crossfades?.length, 0);
});
test('moves and trims clamp before containment, identical bounds and triple overlaps', () => {
  const p = make(), t = p.tracks[0];
  const contained = moveClip(p, t.id, 'b', 0);
  assert.ok(contained.tracks[0].clips[1].timelineStart > 0);
  t.clips.push({ ...t.clips[1], id: 'c', timelineStart: 20, sourceStart: 20, sourceEnd: 30 });
  const triple = moveClip(p, t.id, 'c', 5);
  const clips = triple.tracks[0].clips;
  assert.ok(Math.min(...clips.map((c) => c.timelineStart + c.sourceEnd - c.sourceStart)) <= Math.max(...clips.map((c) => c.timelineStart)));
  const invalid = make(); invalid.tracks[0].clips[1].timelineStart = 0;
  assert.equal(moveClip(invalid, t.id, 'a', 0).tracks[0].clips[1].timelineStart, 0, 'legacy complex overlap stays playable');
});
test('crossfades agree across playback windows and exported chunks', async () => {
  const p = overlap(); const all = await renderEditorWindow(p, sources, 8, 2, [], 1000);
  const a = await renderEditorWindow(p, sources, 8, 1, [], 1000), b = await renderEditorWindow(p, sources, 9, 1, [], 1000);
  assert.deepEqual(new Float32Array([...a, ...b]), all);
  const wav = await renderProjectWav(p, sources, undefined, { rate: 1000, bitDepth: 24 });
  const r = await WavReader.open(wav); r.seek(9000); const x = await r.read(1);
  assert.ok(Math.abs(x[0] - all[2000]) < 1e-6);
  assert.equal(p.tracks[0].clips[0].sourceEnd, 10, 'source boundaries remain immutable');
});
test('linked moves clamp to the nearest position valid on every track', () => {
  const p = make(), host = p.tracks[0]; host.clips.forEach((c) => c.linked = true);
  const guest = structuredClone(host); guest.id = 'guest'; guest.clips = host.clips.map((c) => ({ ...c, id: `guest-${c.id}`, sourceEnd: c.sourceStart + 5 }));
  guest.clips.push({ ...guest.clips[0], id: 'blocker', timelineStart: 4, sourceEnd: 5, linked: false });
  p.tracks.push(guest);
  const moved = moveClip(p, host.id, 'b', 3);
  assert.equal(moved.tracks[0].clips[1].timelineStart, 5);
  assert.equal(moved.tracks[1].clips[1].timelineStart, 5);
});
