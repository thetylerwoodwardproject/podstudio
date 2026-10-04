import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorProject } from './editor-project.ts';
import { recommendedSound } from './recommended-sound.ts';

test('recommended sound is opt-in, preserves sources and edits, and leaves non-voice FX intact', () => {
  const project = createEditorProject({ takeId: 'take', episodeId: '142', name: 'Episode', sources: [
    { id: 'host', name: 'Host', kind: 'voice', duration: 30, sampleRate: 48000, channels: 1 },
    { id: 'music', name: 'Music', kind: 'import', duration: 30, sampleRate: 48000, channels: 2 },
  ] });
  const original = structuredClone(project);
  const next = recommendedSound(project);
  assert.deepEqual(project, original);
  assert.deepEqual(next.tracks.map((t) => t.clips), original.tracks.map((t) => t.clips));
  assert.equal(next.tracks[0].fx.noise, 35);
  assert.equal(next.tracks[0].fx.level, true);
  assert.deepEqual(next.tracks[1].fx, project.tracks[1].fx);
  assert.equal(next.master.loudness, 'stereo');
  assert.equal(next.master.ceilingDb, -1);
  next.tracks[1].muted = true;
  assert.equal(recommendedSound(next).master.loudness, 'mono');
});
