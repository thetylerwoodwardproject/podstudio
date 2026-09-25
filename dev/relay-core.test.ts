import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Presence, Registry } from './relay-core.ts';

test('a session gets 6-digit guest and producer codes', () => {
  const r = new Registry();
  const { session } = r.create('142');
  assert.match(session.codes.guest!, /^\d{6}$/);
  assert.match(session.codes.producer!, /^\d{6}$/);
  assert.notEqual(session.codes.guest, session.codes.producer);
});

test('codes can start with 0', () => {
  const seq = ['004217', '090000'];
  let n = 0;
  const r = new Registry(() => seq[n++]);
  const { session } = r.create('142');
  assert.equal(session.codes.guest, '004217');
});

test('a code joins as its role, and the token authenticates', () => {
  const r = new Registry();
  const { session, hostToken } = r.create('142');
  const j = r.join(session.codes.guest!)!;
  assert.equal(j.role, 'guest');
  assert.equal(r.auth(session.id, j.token), 'guest');
  assert.equal(r.auth(session.id, hostToken), 'host');
  assert.equal(r.auth(session.id, 'nope'), null);
  assert.equal(r.join('12345'), null, 'five digits');
});

test('revoking a code stops it working and signs out whoever used it', () => {
  const r = new Registry();
  const { session } = r.create('142');
  const code = session.codes.guest!;
  const j = r.join(code)!;
  r.revoke(session.id, 'guest');
  assert.equal(r.join(code), null);
  assert.equal(r.auth(session.id, j.token), null);
  const fresh = r.newCode(session.id, 'guest');
  assert.equal(r.join(fresh)!.role, 'guest');
});

test('a new code replaces the old one', () => {
  const r = new Registry();
  const { session } = r.create('142');
  const old = session.codes.producer!;
  r.newCode(session.id, 'producer');
  assert.equal(r.join(old), null);
});

test('codes stay unique across sessions', () => {
  let n = 0;
  const seq = ['111111', '111111', '222222', '111111', '333333', '444444'];
  const r = new Registry(() => seq[n++]);
  const a = r.create('1').session;
  const b = r.create('2').session;
  const all = [a.codes.guest, a.codes.producer, b.codes.guest, b.codes.producer];
  assert.equal(new Set(all).size, 4);
});

test('an ended session takes no one', () => {
  const r = new Registry();
  const { session } = r.create('142');
  const code = session.codes.guest!;
  r.end(session.id);
  assert.equal(r.join(code), null);
});

test('only one guest at a time', () => {
  const p = new Presence<string>();
  p.add('host', 'host');
  assert.equal(p.canJoin('guest'), null);
  p.add('g1', 'guest');
  assert.equal(p.canJoin('guest'), 'A guest is already connected');
  assert.equal(p.canJoin('producer'), null);
  p.remove('g1');
  assert.equal(p.canJoin('guest'), null);
});
