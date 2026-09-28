import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorProject, deleteRange, deriveRetakes, detectPauses, moveClip, projectDuration, splitProject, toneFromFx, trimClip } from './editor-project.ts';

const source = (id: string) => ({ id, kind: 'voice' as const, name: id, duration: 30, channels: 1 as const, sampleRate: 48000 });
const make = () => createEditorProject({ takeId: 'take', episodeId: 'ep', name: 'Episode', sources: [source('host'), source('guest')] });

test('editor project starts with linked immutable source references', () => {
  const p = make();
  assert.equal(p.tracks.length, 2);
  assert.equal(p.tracks[0].clips[0].sourceId, 'host');
  assert.equal(projectDuration(p), 30);
});

test('split and delete preserve time while ripple cut closes it', () => {
  const p = splitProject(make(), 10);
  assert.equal(p.tracks[0].clips.length, 2);
  const hole = deleteRange(p, 10, 15, false);
  assert.equal(hole.tracks[0].clips[1].timelineStart, 15);
  assert.equal(projectDuration(hole), 30);
  const ripple = deleteRange(p, 10, 15, true);
  assert.equal(ripple.tracks[0].clips[1].timelineStart, 10);
  assert.equal(projectDuration(ripple), 25);
  assert.equal(ripple.tracks[1].clips[1].timelineStart, 10, 'linked guest follows');
});

test('moving stays linked unless explicitly unlinked and trim never destroys source metadata', () => {
  const p = splitProject(make(), 10);
  const id = p.tracks[0].clips[1].id;
  const moved = moveClip(p, p.tracks[0].id, id, 14);
  assert.equal(moved.tracks[0].clips[1].timelineStart, 14);
  assert.equal(moved.tracks[1].clips[1].timelineStart, 14);
  const trimmed = trimClip(moved, moved.tracks[0].id, id, 'start', 1);
  assert.equal(trimmed.tracks[0].clips[1].sourceStart, 11);
  assert.equal(trimmed.tracks[1].clips[1].sourceStart, 11, 'linked guest trim follows');
  assert.equal(p.tracks[0].clips[1].sourceStart, 10, 'input project remains unchanged');
});

test('retakes group attempts and provisionally select the last', () => {
  const groups = deriveRetakes([{ t: 8, kind: 'retake', line: 1, attempt: 2 }, { t: 13, kind: 'retake', line: 1, attempt: 3 }], [{ t: 3, line: 1 }, { t: 8, line: 1 }, { t: 13, line: 1 }, { t: 19, line: 2 }], 25);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].attempts.map((x) => [x.start, x.end]), [[3, 8], [8, 13], [13, 19]]);
  assert.equal(groups[0].selected, groups[0].attempts[2].id);
  assert.equal(groups[0].reviewed, false);
});

test('simple podcast FX maps to the existing tone processor', () => {
  const tone = toneFromFx({ noise: 40, low: 2, mid: -1, high: 3, compression: 'Light', level: true });
  assert.deepEqual(tone.eq.gains, [2, 2, 2, -1, -1, -1, 3, 3, 3, 3]);
  assert.equal(tone.comp.on, true);
  assert.equal(tone.comp.preset, 'Light');
});

test('long quiet stretches are suggested without changing the project', () => {
  const a = [0.2, 0.1, 0, 0, 0, 0, 0, 0, 0.2];
  const b = [0.1, 0.1, 0, 0, 0, 0, 0, 0, 0.1];
  const pauses = detectPauses([a, b]);
  assert.deepEqual(pauses.map((p) => [p.start, p.end, p.action]), [[1, 4, 'keep']]);
});
