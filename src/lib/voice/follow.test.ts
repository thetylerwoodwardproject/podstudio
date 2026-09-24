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
  startedWith: unknown = null;
  start(track?: unknown) {
    current = this;
    this.startedWith = track ?? null;
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

test('listens to the given mic track, not the default mic', async () => {
  const v = new VoiceFollow(words, 'en-US');
  const track = { kind: 'audio', readyState: 'live' };
  v.track = track as unknown as MediaStreamTrack;
  await v.start();
  assert.equal((current as unknown as { startedWith: unknown }).startedWith, track);
});

test('an ad-lib holds the reader in place and the script brings them back', async () => {
  const { v, seen, rec } = await follow();
  const events: string[] = [];
  v.addEventListener('lost', () => events.push('lost'));
  v.addEventListener('found', () => events.push('found'));
  rec.say('it was a quiet week in the studio', true);
  const at = seen.at(-1)!;
  rec.say('ha honestly that was the best week we ever had in there', true);
  assert.deepEqual(events, ['lost']);
  assert.equal(seen.at(-1), at, 'the ad-lib moved the reader');
  rec.say('the', false); // one stray word isn't the script resuming
  assert.deepEqual(events, ['lost']);
  rec.say('the until the new', true);
  assert.deepEqual(events, ['lost', 'found']);
  assert.equal(words[seen.at(-1)!], 'new');
});

test('an ad-lib marked by hand holds until released', async () => {
  const { v } = await follow();
  const events: { type: string; manual?: boolean }[] = [];
  v.addEventListener('lost', (e) => events.push({ type: 'lost', manual: (e as CustomEvent<{ manual: boolean }>).detail.manual }));
  v.addEventListener('found', () => events.push({ type: 'found' }));
  v.holdAdlib();
  v.release();
  assert.deepEqual(events, [{ type: 'lost', manual: true }, { type: 'found' }]);
});
