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
