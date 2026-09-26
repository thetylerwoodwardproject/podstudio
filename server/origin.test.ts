import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { test } from 'node:test';
import { checkOrigin } from './origin.ts';

const req = (headers: Record<string, string>, method = 'POST') => ({ method, headers }) as unknown as IncomingMessage;

test('a page on the same host may make changes', () => {
  assert.equal(checkOrigin(req({ host: 'podcast.example.com', origin: 'https://podcast.example.com' }), []), null);
  assert.equal(checkOrigin(req({ host: 'podcast.example.com:443', origin: 'https://podcast.example.com' }), []), null, 'default port');
  assert.equal(checkOrigin(req({ host: '192.168.1.20:4321', origin: 'https://192.168.1.20:4321' }), []), null, 'LAN address');
});

test('a proxy that rewrites Host is trusted by its forwarded host', () => {
  assert.equal(checkOrigin(req({ host: '127.0.0.1:4321', 'x-forwarded-host': 'podcast.example.com', origin: 'https://podcast.example.com' }), []), null);
  assert.equal(checkOrigin(req({ host: 'localhost:4321', forwarded: 'for=1.2.3.4;proto=https;host=podcast.example.com', origin: 'https://podcast.example.com' }), []), null);
});

test('PODSTUDIO_ORIGIN adds addresses', () => {
  assert.equal(checkOrigin(req({ host: '127.0.0.1:4321', origin: 'https://podcast.example.com' }), ['https://podcast.example.com']), null);
  assert.equal(checkOrigin(req({ host: '127.0.0.1:4321', origin: 'https://www.example.com' }), ['https://podcast.example.com', 'https://www.example.com']), null);
});

test('another site is refused, and the reason names both addresses', () => {
  const why = checkOrigin(req({ host: 'podcast.example.com', origin: 'https://evil.example' }), []);
  assert.match(why ?? '', /evil\.example.*podcast\.example\.com/);
  assert.ok(checkOrigin(req({ host: 'podcast.example.com', origin: 'null' }), []), 'an opaque origin');
});

test('reads and requests without an Origin are not checked', () => {
  assert.equal(checkOrigin(req({ host: 'a', origin: 'https://evil.example' }, 'GET'), []), null);
  assert.equal(checkOrigin(req({ host: 'a' }), []), null);
});
