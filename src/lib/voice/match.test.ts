import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locate, normalize, similarity } from './match.ts';

const script = normalize(
  'It was a quiet week in the studio, until the new transmitter arrived. Four pallets, one forklift, and a delivery driver who swore he had never seen anything that heavy come off a truck. So this episode is about what happens after the crate is open.',
);
const at = (i: number) => script[i];

test('normalize strips punctuation and spells numbers', () => {
  assert.deepEqual(normalize('Four. I counted 4 — it’s 21!'), ['four', 'i', 'counted', 'four', 'its', 'twenty', 'one']);
});

test('similarity tolerates small mishearings', () => {
  assert.ok(similarity('transmitter', 'transmiter') > 0.85);
  assert.ok(similarity('pallets', 'ballots') < 0.75);
});

test('follows a straight read', () => {
  const r = locate(script, normalize('a quiet week in the'), 0);
  assert.equal(r && at(r.index), 'the');
  assert.equal(r!.index, 6);
});

test('handles dropped and misheard words', () => {
  const r = locate(script, normalize('until new transmiter arrived'), 7);
  assert.equal(r && at(r.index), 'arrived');
});

test('ignores ad-libs that are not in the script', () => {
  assert.equal(locate(script, normalize('honestly that was wild right'), 12), null);
});

test('picks the occurrence nearest the cursor', () => {
  // "the" appears several times; with context it should land on the second sentence's "the".
  const r = locate(script, normalize('until the'), 7);
  assert.equal(r!.index, 9);
});

test('recognition that jumps ahead a sentence is followed', () => {
  const r = locate(script, normalize('so this episode is about'), 12);
  assert.equal(r && at(r.index), 'about');
});

test('a single word only counts right after the cursor', () => {
  assert.equal(locate(script, ['truck'], 0), null);
  assert.equal(locate(script, ['it'], 0)!.index, 0);
});

test('a half-recognized last word still places the reader', () => {
  // "...until the new transmi" → reader is on "transmitter"
  const r = locate(script, normalize('studio until the new transmi'), 7);
  assert.equal(r && at(r.index), 'transmitter');
});

test('a jump back is followed when the reader re-reads', () => {
  const r = locate(script, normalize('it was a quiet week'), 0, { behind: 0 });
  assert.equal(r && at(r.index), 'week');
});

// Takes mode showed the next speaker's line after a few words: these jumps caused it.
const turn = normalize('Power, cooling, and the first time we keyed it up. And whether the floor could hold it.');

test('a filler word does not jump the reader to the next line', () => {
  // "and" heard after "first time" matches the next line's "And", five words on.
  const r = locate(turn, normalize('first time and'), 6);
  assert.ok(!r || r.index <= 8, `jumped to ${r && turn[r.index]}`);
});

test('a half word only moves the reader on when it starts the next word', () => {
  // "so" isn't the start of "four", so the reader stays on "arrived".
  const r = locate(script, normalize('the new transmitter arrived so'), 11);
  assert.ok(!r || at(r.index) !== 'four', 'moved on to "four"');
  assert.equal(at(locate(script, normalize('the new transmitter arrived fo'), 11)!.index), 'four');
});

test('common words in order still place the reader', () => {
  const r = locate(turn, normalize('keyed it up and whether the'), 8);
  assert.equal(r && turn[r.index], 'the');
});
