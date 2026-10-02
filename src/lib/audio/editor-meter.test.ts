import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorProject } from '../editor-project.ts';
import { renderEditorWindow, type EditorSources } from './editor-render.ts';
import { joinMeterWindows, meterDbfs, outputMeterWindow, trackMeterWindow } from './editor-meter.ts';

test('processed mono and stereo peaks report calibrated dBFS and clipping', () => {
  const mono = trackMeterWindow(Float32Array.from([.5, .5, 0, 0]), 1, 40, 2);
  assert.ok(Math.abs(meterDbfs(mono, 2) - (-6.0206)) < .001);
  assert.equal(meterDbfs(mono, 2.06), -Infinity);
  const stereo = trackMeterWindow(Float32Array.from([.25, 1.25, .5, .125]), 2, 40, 0);
  assert.ok(Math.abs(meterDbfs(stereo, 0, 0) - (-6.0206)) < .001);
  assert.ok(meterDbfs(stereo, 0, 1) > 0);
});

test('master output reports independent left and right peaks, including mono output', () => {
  const stereo = outputMeterWindow(Float32Array.from([.5, .25, .5, .25]), 2, 40, 1);
  assert.ok(Math.abs(meterDbfs(stereo, 1, 0) - (-6.0206)) < .001);
  assert.ok(Math.abs(meterDbfs(stereo, 1, 1) - (-12.0412)) < .001);
  const mono = outputMeterWindow(Float32Array.from([.25, .5]), 1, 40, 1);
  assert.equal(meterDbfs(mono, 1, 0), meterDbfs(mono, 1, 1));
});

test('meter windows join across render boundaries at the same playback time', () => {
  const first = trackMeterWindow(new Float32Array(100).fill(.25), 1, 1000, 0);
  const second = trackMeterWindow(new Float32Array(100).fill(.5), 1, 1000, .05);
  const joined = joinMeterWindows([first, second])!;
  assert.ok(Math.abs(meterDbfs(joined, .049) - (-12.0412)) < .001);
  assert.ok(Math.abs(meterDbfs(joined, .051) - (-6.0206)) < .001);
});

test('render callback meters post-gain track PCM without another source read', async () => {
  const project = createEditorProject({ takeId: 'meter', episodeId: 'e', name: 'Meter', sources: [
    { id: 'host', kind: 'voice', name: 'Host', duration: 1, channels: 1, sampleRate: 1000 },
    { id: 'pads', kind: 'pads', name: 'Pads', duration: 1, channels: 2, sampleRate: 1000 },
  ] });
  project.tracks[0].gainDb = 6;
  let reads = 0;
  const sources: EditorSources = new Map([
    ['host', { channels: 1, sampleRate: 1000, read: async (_from, seconds) => { reads++; return new Float32Array(Math.round(seconds * 1000)).fill(.25); } }],
    ['pads', { channels: 2, sampleRate: 1000, read: async (_from, seconds) => { reads++; return new Float32Array(Math.round(seconds * 1000) * 2).fill(.5); } }],
  ]);
  const meters = new Map<string, ReturnType<typeof trackMeterWindow>>();
  await renderEditorWindow(project, sources, 0, .1, [], 1000, undefined, undefined, (track, audio, from, rate) => {
    meters.set(track.id, trackMeterWindow(audio, track.channels, rate, from));
  });
  assert.equal(reads, 2);
  assert.ok(Math.abs(meterDbfs(meters.get(project.tracks[0].id), .025) - (-6.0412)) < .05);
  assert.ok(Math.abs(meterDbfs(meters.get(project.tracks[1].id), .025) - (-6.0206)) < .05);
  meters.clear();
  await renderEditorWindow(project, sources, 0, .1, [project.tracks[0].id], 1000, undefined, undefined, (track, audio, from, rate) => meters.set(track.id, trackMeterWindow(audio, track.channels, rate, from)));
  assert.equal(meters.has(project.tracks[1].id), false);
  project.tracks[0].muted = true;
  await renderEditorWindow(project, sources, 0, .1, [project.tracks[0].id], 1000, undefined, undefined, (track, audio, from, rate) => meters.set(track.id, trackMeterWindow(audio, track.channels, rate, from)));
  assert.equal(meterDbfs(meters.get(project.tracks[0].id), .025), -Infinity);
});

test('meter follows the rendered FX and fade envelope', async () => {
  const rate = 48000;
  const input = Float32Array.from({ length: rate / 5 }, (_, i) => Math.sin(i * 2 * Math.PI * 440 / rate) * .5);
  const project = createEditorProject({ takeId: 'fade', episodeId: 'e', name: 'Fade', sources: [{ id: 'voice', kind: 'voice', name: 'Voice', duration: .2, channels: 1, sampleRate: rate }] });
  project.tracks[0].clips[0].fadeInMs = 100;
  project.tracks[0].fx.mid = 4;
  const sources: EditorSources = new Map([['voice', { channels: 1, sampleRate: rate, read: async (from, seconds) => input.subarray(Math.round(from * rate), Math.round((from + seconds) * rate)) }]]);
  let meter: ReturnType<typeof trackMeterWindow> | undefined;
  const mix = await renderEditorWindow(project, sources, 0, .2, [], rate, undefined, undefined, (track, audio, from, sampleRate) => {
    meter = trackMeterWindow(audio, track.channels, sampleRate, from);
  });
  assert.ok(meter);
  const firstPeak = Math.max(...Array.from({ length: rate / 20 }, (_, i) => Math.abs(mix[i * 2])));
  assert.ok(Math.abs(meterDbfs(meter, .025) - 20 * Math.log10(firstPeak)) < .001);
  assert.ok(meterDbfs(meter, .025) < meterDbfs(meter, .15));
});
