import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorProject } from '../editor-project.ts';
import { finishedProject, renderEditorWindow, type EditorSources } from './editor-render.ts';

test('window rendering reads only the requested source interval', async () => {
  const calls: [number, number][] = [];
  const project = createEditorProject({ takeId: 't', episodeId: 'e', name: 'Episode', sources: [{ id: 'host', kind: 'voice', name: 'Host', duration: 3600, channels: 1, sampleRate: 100 }] });
  const sources: EditorSources = new Map([['host', { channels: 1, sampleRate: 100, read: async (from, seconds) => { calls.push([from, seconds]); return new Float32Array(Math.round(seconds * 100)).fill(.25); } }]]);
  const out = await renderEditorWindow(project, sources, 1800, 10, [], 100);
  assert.deepEqual(calls, [[1800, 10]]);
  assert.equal(out.length, 2000);
});

test('finished project removes rejected retakes and chosen pauses without changing source bounds', () => {
  const project = createEditorProject({ takeId: 't', episodeId: 'e', name: 'Episode', sources: [{ id: 'host', kind: 'voice', name: 'Host', duration: 30, channels: 1, sampleRate: 48000 }], markers: [{ kind: 'retake', line: 0, t: 5 }, { kind: 'retake', line: 0, t: 10 }], lineLog: [{ line: 0, t: 0 }, { line: 1, t: 15 }] });
  project.retakes[0].reviewed = true;
  project.pauses = [{ id: 'p', start: 20, end: 24, source: 'detected', action: 'shorten', keepSeconds: 1 }];
  const rawEnd = project.tracks[0].clips[0].sourceEnd;
  const done = finishedProject(project);
  assert.equal(project.tracks[0].clips[0].sourceEnd, rawEnd);
  assert.ok(done.tracks[0].clips.length > 0);
  assert.ok(done.tracks[0].clips.every((c) => c.fadeInMs >= 10 && c.fadeOutMs >= 10));
});

import { createRenderState } from './editor-render.ts';
import { moveClip } from '../editor-project.ts';
test('EQ and compressor match uninterrupted rendering across window boundaries without mutating sources', async () => {
  const rate = 48000;
  const input = Float32Array.from({ length: rate * 2 }, (_, i) => Math.sin(i * 2 * Math.PI * 700 / rate) * .5);
  const before = input.slice();
  const p = createEditorProject({ takeId: 't', episodeId: 'e', name: 'test', sources: [{ id: 'h', kind: 'voice', name: 'Host', duration: 2, channels: 1, sampleRate: rate }] });
  p.tracks[0].fx.mid = 4; p.tracks[0].fx.compression = 'Heavy';
  const sources: EditorSources = new Map([['h', { channels: 1, sampleRate: rate, read: async (from, seconds) => input.subarray(Math.round(from * rate), Math.round((from + seconds) * rate)) }]]);
  const whole = await renderEditorWindow(p, sources, 0, 2, [], rate, undefined, createRenderState());
  const state = createRenderState();
  const a = await renderEditorWindow(p, sources, 0, 1, [], rate, undefined, state);
  const b = await renderEditorWindow(p, sources, 1, 1, [], rate, undefined, state);
  assert.deepEqual(a, whole.slice(0, a.length)); assert.deepEqual(b, whole.slice(a.length)); assert.deepEqual(input, before);
});
test('cough suppression follows independently moved source audio', async () => {
  let p = createEditorProject({ takeId: 't', episodeId: 'e', name: 'test', sources: [{ id: 'h', kind: 'voice', name: 'Host', duration: 5, channels: 1, sampleRate: 1000 }], markers: [{ kind: 'cut', t: 1, end: 2, line: 0 }] });
  p = moveClip(p, p.tracks[0].id, p.tracks[0].clips[0].id, 3);
  const sources: EditorSources = new Map([['h', { channels: 1, sampleRate: 1000, read: async (_from, seconds) => new Float32Array(seconds * 1000).fill(.5) }]]);
  const out = await renderEditorWindow(p, sources, 3, 3, [], 1000);
  assert.equal(out[1500 * 2], 0); assert.equal(out[500 * 2], .5);
});

test('reviewed retake removals follow clips moved on the timeline', () => {
  const p = createEditorProject({ takeId: 't', episodeId: 'e', name: 'Retake', sources: [{ id: 'h', kind: 'voice', role: 'host', name: 'Host', channels: 1, sampleRate: 48000, duration: 10 }], markers: [{ kind: 'retake', line: 0, t: 3 }], lineLog: [{ line: 0, t: 0 }, { line: 0, t: 3 }, { line: 1, t: 6 }] });
  p.retakes[0].reviewed = true;
  const moved = moveClip(p, p.tracks[0].id, p.tracks[0].clips[0].id, 20);
  const rendered = finishedProject(moved);
  assert.equal(rendered.tracks[0].clips[0].sourceStart, 3);
  assert.equal(rendered.tracks[0].clips[0].timelineStart, 20);
});
