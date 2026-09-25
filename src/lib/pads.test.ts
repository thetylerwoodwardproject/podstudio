import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KIND_DEFAULTS, effectivePads, newPad, padLength, padTag, setPad, swapKeys } from './pads.ts';
import { parseCue, parseScript } from './script-parser.ts';

const file = { id: 'f1', seconds: 6, name: 'Four pallets bite' };

test('each kind starts with its defaults', () => {
  const music = newPad(2, 'music', file);
  assert.equal(music.mode, 'loop');
  assert.equal(music.duck, true);
  assert.equal(music.fadeOutMs, 2000);
  const sfx = newPad(1, 'sfx', file);
  assert.deepEqual([sfx.mode, sfx.duck, sfx.fadeOutMs], ['oneshot', false, 0]);
  assert.equal(KIND_DEFAULTS.bite.fadeOutMs, 150);
});

test('tags follow the mode first, then the kind', () => {
  assert.equal(padTag({ kind: 'music', mode: 'loop' }), 'LOOP');
  assert.equal(padTag({ kind: 'music', mode: 'oneshot' }), 'MUSIC');
  assert.equal(padTag({ kind: 'sfx', mode: 'hold' }), 'HOLD');
  assert.equal(padTag({ kind: 'bite', mode: 'oneshot' }), 'BITE');
});

test('episode pads override the show set on the same key', () => {
  const show = [newPad(1, 'sfx', file), newPad(2, 'music', file)];
  const ep = [{ ...newPad(2, 'bite', { ...file, name: 'Ep bite' }) }];
  const pads = effectivePads(show, ep);
  assert.deepEqual(pads.map((p) => [p.key, p.name, p.override]), [[1, 'Four pallets bite', false], [2, 'Ep bite', true]]);
});

test('swapping keys and clearing a pad', () => {
  let set = [newPad(1, 'sfx', { ...file, name: 'A' }), newPad(3, 'sfx', { ...file, name: 'B' })];
  set = swapKeys(set, 1, 3);
  assert.deepEqual(set.map((p) => [p.key, p.name]).sort(), [[1, 'B'], [3, 'A']]);
  set = swapKeys(set, 3, 5);
  assert.ok(set.some((p) => p.key === 5 && p.name === 'A'));
  set = setPad(set, 5, null);
  assert.deepEqual(set.map((p) => p.key), [1]);
});

test('trim sets how long a pad plays', () => {
  assert.ok(Math.abs(padLength({ trimStart: 0.2, trimEnd: 6.1, seconds: 8 }) - 5.9) < 1e-9);
  assert.equal(padLength({ trimStart: 1, trimEnd: 0, seconds: 8 }), 7);
});

test('[pad N] lines are cues, not script', () => {
  assert.deepEqual(parseCue('[pad 3]'), { key: 3 });
  assert.deepEqual(parseCue('[Pad 1 · after the joke]'), { key: 1, note: 'after the joke' });
  assert.equal(parseCue('[pad 0]'), null);
  assert.equal(parseCue('say [pad 3] now'), null);
  const s = parseScript('## Cold open\n[pad 1]\nIt was a quiet week.\n[pad 3 · bite]\nFour pallets.');
  assert.equal(s.lines.length, 2);
  assert.deepEqual(s.lines[0].cues, [{ key: 1 }]);
  assert.deepEqual(s.lines[1].cues, [{ key: 3, note: 'bite' }]);
  assert.equal(s.words, 7);
});
