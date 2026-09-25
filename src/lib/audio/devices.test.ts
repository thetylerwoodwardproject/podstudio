import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inputFor, parseInput } from './devices.ts';

test('a device on its own records input 1', () => {
  assert.deepEqual(parseInput(''), { deviceId: '', channel: 0 });
  assert.deepEqual(parseInput('abc'), { deviceId: 'abc', channel: 0 });
});

test('one input, or all of them mixed', () => {
  assert.deepEqual(parseInput('abc#1'), { deviceId: 'abc', channel: 1 });
  assert.deepEqual(parseInput('abc#mix'), { deviceId: 'abc', channel: null });
});

test('stereo drops the input choice', () => {
  assert.equal(inputFor('abc#1', 2), 'abc');
  assert.equal(inputFor('abc#mix', 2), 'abc');
  assert.equal(inputFor('abc#1', 1), 'abc#1');
});
