import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestOffset } from './room.ts';

test('the quickest round trip sets the clock offset', () => {
  // Server is 5000 ms ahead. The second ping had a slow way back.
  const samples = [
    { sent: 1000, received: 1040, server: 6020 },
    { sent: 2000, received: 2300, server: 7020 },
    { sent: 3000, received: 3010, server: 8005 },
  ];
  assert.equal(bestOffset(samples), 5000);
});

test('a server behind us gives a negative offset', () => {
  assert.equal(bestOffset([{ sent: 10000, received: 10020, server: 7010 }]), -3000);
});

test('no samples, no offset', () => assert.equal(bestOffset([]), 0));
