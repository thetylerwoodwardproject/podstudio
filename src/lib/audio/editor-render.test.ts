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
