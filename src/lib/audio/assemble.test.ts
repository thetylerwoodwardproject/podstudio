import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, audacityLabels, merge, type LineStart, type SessionMarker } from './assemble.ts';

// Line 0 at 0 s, line 1 at 10 s, retake of line 1 at 18 s (restarts at 18),
// second retake at 25 s, line 2 at 32 s, a pause 40–50 s, line 3 at 50 s.
const lineLog: LineStart[] = [
  { t: 0, line: 0 },
  { t: 10, line: 1 },
  { t: 18, line: 1 },
  { t: 25, line: 1 },
  { t: 32, line: 2 },
  { t: 50, line: 3 },
];
const markers: SessionMarker[] = [
  { t: 18, kind: 'retake', line: 1, attempt: 2 },
  { t: 25, kind: 'retake', line: 1, attempt: 3 },
  { t: 40, kind: 'pause', line: 2, end: 50 },
];

test('merge joins overlapping ranges', () => {
  assert.deepEqual(merge([[5, 8], [0, 2], [1, 3], [8, 9]]), [[0, 3], [5, 9]]);
});

test('retakes keep only the last attempt of a line', () => {
  const a = assemble(60, markers, lineLog, 'keep');
  assert.deepEqual(a.cuts, [[10, 25]]);
  assert.deepEqual(a.files, [[[0, 10], [25, 60]]]);
  assert.equal(a.removed, 15);
});

test('pauses can be cut', () => {
  const a = assemble(60, markers, lineLog, 'cut');
  assert.deepEqual(a.files, [[[0, 10], [25, 40], [50, 60]]]);
  assert.equal(a.removed, 25);
});

test('pauses can split the edit into files', () => {
  const a = assemble(60, markers, lineLog, 'split');
  assert.deepEqual(a.files, [[[0, 10], [25, 40]], [[50, 60]]]);
});

test('a pause still running at the end runs to the end', () => {
  const a = assemble(60, [{ t: 55, kind: 'pause', line: 3 }], lineLog, 'cut');
  assert.deepEqual(a.files, [[[0, 55]]]);
});

test('a retake with no known line start cuts nothing', () => {
  const a = assemble(30, [{ t: 20, kind: 'retake', line: 7, attempt: 2 }], lineLog, 'keep');
  assert.deepEqual(a.files, [[[0, 30]]]);
  assert.equal(a.removed, 0);
});

test('Audacity labels are tab separated and sorted', () => {
  const text = audacityLabels([...markers].reverse(), (m) => `${m.kind} ${m.line + 1}`);
  assert.equal(text, '18.000000\t18.000000\tretake 2\n25.000000\t25.000000\tretake 2\n40.000000\t50.000000\tpause 3\n');
});

test('mapTime follows the kept ranges', async () => {
  const { mapTime } = await import('./assemble.ts');
  assert.equal(mapTime(5, [[0, 10], [25, 60]]), 5);
  assert.equal(mapTime(30, [[0, 10], [25, 60]]), 15);
  assert.equal(mapTime(15, [[0, 10], [25, 60]]), null);
});

test('ad-libs are marked, not cut', () => {
  const a = assemble(60, [{ t: 10, kind: 'adlib', line: 2, end: 25 }], [{ t: 0, line: 0 }], 'cut');
  assert.equal(a.removed, 0);
  assert.deepEqual(a.files, [[[0, 60]]]);
});

test('a cough cut inside a kept stretch is removed, whatever the pause mode', () => {
  const cut: SessionMarker = { t: 12, kind: 'cut', line: 1, end: 14 };
  for (const mode of ['cut', 'keep', 'split'] as const) {
    const a = assemble(60, [cut], [{ t: 0, line: 0 }], mode);
    assert.deepEqual(a.files, [[[0, 12], [14, 60]]], mode);
    assert.equal(a.removed, 2);
  }
});

test('a cough cut overlapping a retake merges with it', () => {
  // Line 1 starts at 10, retake at 18 cuts 10–18; the cough runs 17–20.
  const a = assemble(
    60,
    [{ t: 18, kind: 'retake', line: 1, attempt: 2 }, { t: 17, kind: 'cut', line: 1, end: 20 }],
    [{ t: 0, line: 0 }, { t: 10, line: 1 }],
    'cut',
  );
  assert.deepEqual(a.cuts, [[10, 20]]);
  assert.equal(a.removed, 10);
});

test('a cough cut running past the end stops at the end', () => {
  const a = assemble(30, [{ t: 28, kind: 'cut', line: 3, end: 31 }], [{ t: 0, line: 0 }], 'cut');
  assert.deepEqual(a.files, [[[0, 28]]]);
  assert.equal(a.removed, 2);
});

test('markers after a gap move earlier by its length', async () => {
  const { onAudio, audioTime } = await import('./assemble.ts');
  // The mic stopped 20–26 on the wall clock: the audio jumps from 20 straight to what came at 26.
  const gap: SessionMarker = { t: 20, kind: 'gap', line: 1, end: 26 };
  const retake: SessionMarker = { t: 36, kind: 'retake', line: 2, attempt: 2 };
  const log = [{ t: 0, line: 0 }, { t: 10, line: 1 }, { t: 30, line: 2 }];
  const on = onAudio([gap, retake], log);
  assert.deepEqual(on.lineLog.map((s) => s.t), [0, 10, 24]);
  assert.equal(on.markers[1].t, 30);
  assert.deepEqual([on.markers[0].t, on.markers[0].lost, on.markers[0].end], [20, 6, undefined]);
  assert.equal(audioTime(23, [[20, 26]]), 20, 'inside a gap lands where it started');
  // The retake cuts line 2's first attempt, 24–30 on the audio.
  const a = assemble(44, [gap, retake], log, 'cut');
  assert.deepEqual(a.cuts, [[24, 30]]);
});

test('two gaps add up', async () => {
  const { audioTime } = await import('./assemble.ts');
  assert.equal(audioTime(50, [[10, 12], [30, 35]]), 43);
});
