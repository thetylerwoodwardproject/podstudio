import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUICK, missingNotes, picked, planFiles, type PlanInput } from './export-files.ts';

const tyler = { name: 'Tyler', host: true, rate: 48000, frameBytes: 3, copy: 'toned' as const };
const base: PlanInput = {
  label: 'Ep142',
  people: [tyler],
  duration: 40,
  rate: 48000,
  bitDepth: 24,
  assembled: true,
  pauses: 'cut',
  editParts: [32],
  ns: 60,
  markerTones: false,
  pads: false,
  roughMix: false,
  loudness: 'mono',
  toned: true,
  markers: 3,
  voiceLog: 2,
};

test('the default case: the same 11 files the export wrote', () => {
  const names = planFiles(base).map((f) => f.name).sort();
  assert.deepEqual(names, [
    'Ep142_Episode.mp3',
    'Ep142_Episode.wav',
    'Ep142_Session_Tyler.wav',
    'Ep142_Session_Tyler_clean.wav',
    'Ep142_Session_Tyler_edit.wav',
    'Ep142_Session_Tyler_edit_clean.wav',
    'Ep142_Session_Tyler_edit_toned.wav',
    'Ep142_Session_export.txt',
    'Ep142_Session_markers.csv',
    'Ep142_Session_markers.txt',
    'Ep142_Session_voice-log.txt',
  ]);
});

test('kinds leave out the episode, the person and the part', () => {
  const files = planFiles({ ...base, pauses: 'split', editParts: [10, 12], people: [tyler, { name: 'Sam', host: false, rate: 44100, frameBytes: 2, copy: null }] });
  const f = files.find((x) => x.name === 'Ep142_Session_Sam_edit_part2_clean.wav')!;
  assert.equal(f.kind, 'voice_edit_clean.wav');
  assert.match(f.desc, /Part 2\.$/);
  assert.ok(files.some((x) => x.name === 'Ep142_Episode_part2.mp3' && x.kind === 'episode.mp3'));
  assert.ok(!files.some((x) => x.name.startsWith('Ep142_Session_Sam_edit') && x.kind.includes('toned')), 'Sam has no tone');
  // Sam's raw file: his own rate and format, as long as the session
  assert.equal(files.find((x) => x.name === 'Ep142_Session_Sam.wav')!.bytes, 40 * 44100 * 2 + 44);
});

test('what the settings change', () => {
  const names = (o: Partial<PlanInput>) => planFiles({ ...base, ...o }).map((f) => f.name);
  assert.ok(!names({ ns: 0 }).some((n) => n.includes('_clean')));
  assert.ok(!names({ assembled: false }).some((n) => n.includes('_edit')));
  assert.ok(names({ assembled: false }).includes('Ep142_Session_Tyler_toned.wav'), 'the copy is of the whole recording');
  assert.ok(names({ pads: true, roughMix: true }).includes('Ep142_Session_RoughMix.wav'));
  assert.ok(names({ pads: true }).includes('Ep142_Session_Pads_edit.wav') && !names({ pads: true }).includes('Ep142_Session_RoughMix.wav'));
  assert.ok(!names({ voiceLog: 0 }).includes('Ep142_Session_voice-log.txt'));
  assert.match(planFiles({ ...base, loudness: 'stereo' }).find((f) => f.kind === 'episode.mp3')!.desc, /192 kbps stereo/);
  assert.deepEqual(missingNotes({ assembled: true, ns: 0, people: [{ ...tyler, copy: null }] }), ['No _clean copies: noise suppression is off.', 'No toned copy of the edit: tone and levelling are off.']);
});

test('picks: chosen here, else the saved kinds, else ticked; quick picks', () => {
  const files = planFiles(base);
  const ep = files.find((f) => f.kind === 'episode.wav')!;
  const raw = files.find((f) => f.kind === 'voice.wav')!;
  assert.equal(picked(ep, {}, null), true);
  assert.equal(picked(raw, {}, ['episode.wav']), false);
  assert.equal(picked(raw, { [raw.name]: true }, ['episode.wav']), true);
  const publish = QUICK.find((q) => q.id === 'publish')!;
  assert.deepEqual(files.filter(publish.pick).map((f) => f.kind), ['episode.wav', 'episode.mp3']);
  const daw = QUICK.find((q) => q.id === 'daw')!;
  assert.deepEqual(files.filter(daw.pick).map((f) => f.kind), ['voice_edit.wav', 'voice_edit_clean.wav', 'voice_edit_toned.wav', 'markers.txt', 'markers.csv']);
});
