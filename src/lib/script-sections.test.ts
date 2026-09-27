import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScript } from './script-parser.ts';
import { flattenSections, groupSections, moveItem, readSeconds, readTime } from './script-sections.ts';

const text = `Welcome, everyone.
## Cold open
HOST: One two three four five.
GUEST: Six seven.
## The story
Eight nine ten.
## Sponsor read
HOST: Eleven.`;

test('sections are grouped, with the lines before the first heading kept apart', () => {
  const { intro, sections } = groupSections(parseScript(text).lines);
  assert.equal(intro.length, 1);
  assert.deepEqual(sections.map((s) => [s.name, s.lines.length]), [['Cold open', 2], ['The story', 1], ['Sponsor read', 1]]);
});

test('rename and reorder: the lines move with their section and keep their speakers', () => {
  const { intro, sections } = groupSections(parseScript(text).lines);
  sections[1].name = 'Main story';
  const lines = flattenSections(intro, moveItem(sections, 1, 0));
  assert.deepEqual(lines.map((l) => l.section), [null, 'Main story', 'Cold open', 'Cold open', 'Sponsor read']);
  // "Eight nine ten." follows the guest in the original, so it's the guest's; moved, it stays theirs.
  assert.equal(lines[1].text, 'Eight nine ten.');
  assert.equal(lines[1].who, 'GUEST');
  assert.equal(lines[2].who, 'HOST');
});

test('read time at a words-per-minute rate', () => {
  const { sections } = groupSections(parseScript(text).lines);
  assert.equal(readSeconds(sections[0].lines, 150), (7 / 150) * 60);
  assert.equal(readTime(310), '~5:10');
  assert.equal(readTime(40), '~0:40');
});

test('moving to the ends', () => {
  assert.deepEqual(moveItem([1, 2, 3], 0, 2), [2, 3, 1]);
  assert.deepEqual(moveItem([1, 2, 3], 2, 0), [3, 1, 2]);
  assert.deepEqual(moveItem([1, 2, 3], 1, 9), [1, 3, 2]);
});
