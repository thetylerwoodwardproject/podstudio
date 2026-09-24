import { test } from 'node:test';
import assert from 'node:assert/strict';

// A stand-in for Chrome's speech recognition: tests push transcripts into it.
let current: FakeRecognition | null = null;
class FakeRecognition extends EventTarget {
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  results: { transcript: string; isFinal: boolean }[] = [];
  start() {
    current = this;
  }
  stop() {}
  abort() {}
  /** Replace the latest (interim) result, or add a new one. */
  say(text: string, final = false) {
    const last = this.results.at(-1);
    if (last && !last.isFinal) last.transcript = text;
    else this.results.push({ transcript: text, isFinal: false });
    this.results.at(-1)!.isFinal = final;
    const results = this.results.map((r) => Object.assign([{ transcript: r.transcript }], { isFinal: r.isFinal }));
    this.onresult?.({ resultIndex: 0, results });
  }
}
(globalThis as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognition;

const { VoiceFollow } = await import('./follow.ts');
const words = 'It was a quiet week in the studio, until the new transmitter arrived. Four pallets? I heard it was five, and one of them was just foam.'.split(' ');

async function follow() {
  const v = new VoiceFollow(words, 'en-US');
  const seen: number[] = [];
  v.addEventListener('word', (e) => seen.push((e as CustomEvent<number>).detail));
  await v.start();
  return { v, seen, rec: current! };
}

test('follows a straight read, word by word', async () => {
  const { seen, rec } = await follow();
  rec.say('it was a');
  rec.say('it was a quiet week');
  rec.say('it was a quiet week in the studio', true);
  assert.equal(seen.at(-1), 7);
});

test('a jump back is not undone by words heard before it', async () => {
  const { v, seen, rec } = await follow();
  rec.say('it was a quiet week in the studio until the new transmitter arrived', true);
  assert.equal(words[seen.at(-1)!], 'arrived.');
  v.setWord(0); // clicked the first line
  const before = seen.length;
  rec.say('it'); // a new word arrives; old words must not pull the reader forward
  assert.ok(seen.slice(before).every((i) => i <= 1), `jumped to ${seen.slice(before)}`);
  rec.say('it was a quiet');
  assert.equal(words[seen.at(-1)!], 'quiet');
});

test('a retake rollback sticks', async () => {
  const { v, seen, rec } = await follow();
  rec.say('four pallets i heard it was five', true);
  v.setWord(13); // back to "Four"
  rec.say('four pallets');
  assert.equal(words[seen.at(-1)!], 'pallets?');
});

test('a half-heard last word still moves the reader', async () => {
  const { seen, rec } = await follow();
  rec.say('it was a quiet week in the studio until the new transmi');
  assert.equal(words[seen.at(-1)!], 'transmitter');
});

test('uses on-device recognition when the language pack is installed', async () => {
  (FakeRecognition as unknown as { available: () => Promise<string> }).available = async () => 'available';
  const { v, rec } = await follow();
  assert.equal(v.local, true);
  assert.equal((rec as unknown as { processLocally: boolean }).processLocally, true);
  delete (FakeRecognition as unknown as { available?: unknown }).available;
});
