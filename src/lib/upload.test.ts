import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Uploader } from './upload.ts';

test('sends segments in order as they appear', async () => {
  let have = 2;
  const sent: number[] = [];
  const u = new Uploader(() => have, async (n) => void sent.push(n));
  await u.tick();
  have = 5;
  await u.tick();
  assert.deepEqual(sent, [1, 2, 3, 4, 5]);
  assert.deepEqual(u.status, { uploaded: 5, pending: 0, error: '' });
});

test('a failure waits, then retries the same segment', async () => {
  const sent: number[] = [];
  let fail = true;
  const u = new Uploader(() => 3, async (n) => {
    if (n === 2 && fail) throw new Error('offline');
    sent.push(n);
  });
  await u.tick(0);
  assert.deepEqual(u.status, { uploaded: 1, pending: 2, error: 'offline' });
  await u.tick(500); // still backing off
  assert.deepEqual(sent, [1]);
  fail = false;
  await u.tick(1500);
  assert.deepEqual(sent, [1, 2, 3]);
});

test('backoff grows, up to 30 s between tries', async () => {
  let attempts = 0;
  const u = new Uploader(() => 1, async () => {
    attempts++;
    throw new Error('down');
  });
  // 1, 2, 4, 8, 16, 30, 30… s apart: about 11 tries in 200 s.
  for (let t = 0; t < 200000; t += 250) await u.tick(t);
  assert.ok(attempts >= 8 && attempts <= 14, `${attempts} attempts`);
});

test('resumes after segments already sent', async () => {
  const sent: number[] = [];
  const u = new Uploader(() => 6, async (n) => void sent.push(n), undefined, 4);
  await u.tick();
  assert.deepEqual(sent, [5, 6]);
});

test('ticks don’t overlap', async () => {
  const sent: number[] = [];
  const u = new Uploader(() => 3, async (n) => {
    await new Promise((r) => setTimeout(r, 5));
    sent.push(n);
  });
  await Promise.all([u.tick(), u.tick(), u.tick()]);
  assert.deepEqual(sent, [1, 2, 3]);
});
