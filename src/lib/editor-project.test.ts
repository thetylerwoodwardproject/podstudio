import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorProject, deleteRange, deriveRetakes, detectPauses, moveClip, projectDuration, splitProject, toneFromFx, trimClip, removeEditorTrack, restoreEditorTrack, cleanEditorProject } from './editor-project.ts';

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

test('trim edges can restore source audio and clamp linked clips together', () => {
  const p = make(); const track = p.tracks[0], id = track.clips[0].id;
  const shorter = trimClip(p, track.id, id, 'end', 4);
  assert.equal(shorter.tracks[0].clips[0].sourceEnd, 26);
  assert.equal(trimClip(shorter, track.id, id, 'end', -20).tracks[0].clips[0].sourceEnd, 30);
  const start = trimClip(p, track.id, id, 'start', 3);
  const restored = trimClip(start, track.id, id, 'start', -10);
  assert.equal(restored.tracks[0].clips[0].sourceStart, 0);
  assert.equal(restored.tracks[1].clips[0].timelineStart, 0);
});

import { cleanMaster, timelineMarkers, deleteClip, masterOptions } from './editor-project.ts';

test('removing a track is undoable project metadata and retains its immutable source', () => {
  let original = splitProject(make(), 10);
  original = moveClip(original, original.tracks[0].id, original.tracks[0].clips[1].id, 8);
  const id = original.tracks[0].id;
  assert.ok(original.crossfades?.some((fade) => fade.trackId === id));
  const removed = removeEditorTrack(original, id);
  assert.equal(removed.tracks.length, 1);
  assert.equal(removed.removedTracks?.[0].sourceId, 'host');
  assert.ok(!removed.crossfades?.some((fade) => fade.trackId === id));
  assert.equal(original.tracks.length, 2);
  const reopened = cleanEditorProject(JSON.parse(JSON.stringify(removed)))!;
  const restored = restoreEditorTrack(reopened, id);
  assert.equal(restored.tracks.length, 2);
  assert.equal(restored.removedTracks?.length, 0);
  assert.equal(restored.tracks.find((track) => track.id === id)?.clips[0].sourceId, 'host');
});
import { cleanTone, flatTone } from './audio/tone.ts';
test('advanced settings round-trip and old projects retain defaults', () => {
  const p = make(); const tone = flatTone(); tone.eq.on = true; tone.eq.gains[3] = -7; tone.comp.attackMs = 42;
  p.tracks[0].fx.tone = tone;
  const loaded = cleanEditorProject(JSON.parse(JSON.stringify(p)))!;
  assert.deepEqual(toneFromFx(loaded.tracks[0].fx), cleanTone(tone));
  assert.equal(loaded.master.ceilingDb, -1);
  assert.equal(cleanTone(flatTone()).comp.releaseMs, 150);
  assert.equal(cleanMaster({ targetLufs: 3, ceilingDb: 5 }).targetLufs, -10);
  assert.equal(masterOptions({ loudness: 'custom', targetLufs: -22, channels: 1, mp3: false, rawTracks: false }).lufs, -22);
});
test('markers follow moved and trimmed source clips and selected deletion leaves other clips alone', () => {
  const p = make(); p.tracks[1].role = 'guest';
  p.sourceMarkers = [{ kind: 'cut', t: 5, end: 7, line: 0 }];
  const moved = moveClip(p, p.tracks[0].id, p.tracks[0].clips[0].id, 10, true);
  assert.equal(timelineMarkers(moved)[0].t, 15);
  const split = splitProject(moved, 20, p.tracks[0].id);
  const deleted = deleteClip(split, p.tracks[0].id, split.tracks[0].clips[0].id);
  assert.equal(deleted.tracks[0].clips.length, 1);
  assert.equal(timelineMarkers(deleted).length, 0);
});

test('independent edits never split or cut linked voices on other tracks', () => {
  const p = make(); p.tracks[0].clips[0].linked = false;
  const split = splitProject(p, 10, p.tracks[0].id);
  assert.equal(split.tracks[1].clips.length, 1);
  const cut = deleteRange(p, 5, 10, true, p.tracks[0].id);
  assert.equal(cut.tracks[1].clips.length, 1);
  assert.equal(cut.tracks[1].clips[0].timelineStart, 0);
  assert.equal(cut.tracks[1].clips[0].sourceEnd, 30);
});
