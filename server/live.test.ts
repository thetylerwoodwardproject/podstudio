import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { signedIn } from './testing.ts';

type Msg = Record<string, any>;

/** A socket into a session's room that keeps what it hears. */
function connect(base: string, session: string, token: string) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/api/ws?session=${session}&token=${token}`);
  const got: Msg[] = [];
  let closed: { code: number; reason: string } | null = null;
  ws.on('message', (d) => got.push(JSON.parse(String(d))));
  ws.on('close', (code, reason) => (closed = { code, reason: String(reason) }));
  const open = new Promise((r) => ws.on('open', r));
  return { ws, got, open, closed: () => closed, send: (m: Msg) => ws.send(JSON.stringify(m)) };
}
const settle = () => new Promise((r) => setTimeout(r, 80));

/** A session with the guest let in and both connected. */
async function room() {
  const s = await signedIn();
  const r = (await s.call('/api/sessions', { body: { episodeId: '142' } })).body;
  const join = async (code: string, name: string) => {
    const j = (await s.call('/api/join', { body: { code, name } })).body;
    s.ctx.live.admit(r.sessionId, s.ctx.live.member(r.sessionId, j.token)!.id);
    return j.token as string;
  };
  const guestToken = await join(r.codes.guest, 'Sam');
  const host = connect(s.base, r.sessionId, r.hostToken);
  const guest = connect(s.base, r.sessionId, guestToken);
  await Promise.all([host.open, guest.open]);
  await settle();
  return { s, r, host, guest, guestToken, join };
}

test('a guest can only cough and report on themselves; the rest is dropped', async () => {
  const { s, r, host, guest, join } = await room();
  try {
    guest.send({ type: 'script', version: 999, text: 'HOST: Not yours.' });
    guest.send({ type: 'state', state: { ended: true } });
    guest.send({ type: 'setup', mode: 'points', points: [] });
    guest.send({ type: 'command', action: 'stop' });
    guest.send({ type: 'command', action: 'cough', down: true });
    guest.send({ type: 'guest', name: 'Sam', level: -20 });
    await settle();
    assert.deepEqual(host.got.filter((m) => m.from === 'guest').map((m) => m.type), ['command', 'guest']);
    assert.equal(host.got.find((m) => m.type === 'command')!.action, 'cough');

    // The producer edits the script and runs the session, but doesn't cough for anyone.
    const producer = connect(s.base, r.sessionId, await join(r.codes.producer, 'Pat'));
    await producer.open;
    producer.send({ type: 'script', version: 2, text: 'HOST: Edited.' });
    producer.send({ type: 'command', action: 'next' });
    producer.send({ type: 'command', action: 'cough', down: true });
    await settle();
    assert.deepEqual(host.got.filter((m) => m.from === 'producer').map((m) => m.type), ['script', 'command']);

    // Whoever connects later catches up on the host's and producer's messages only.
    host.send({ type: 'state', state: { recording: false } });
    await settle();
    const late = connect(s.base, r.sessionId, r.hostToken);
    await late.open;
    await settle();
    assert.deepEqual(late.got.filter((m) => m.type === 'state' || m.type === 'script').map((m) => m.from).sort(), ['host', 'producer']);
    for (const c of [late, producer]) c.ws.close();
  } finally {
    host.ws.close();
    guest.ws.close();
    s.done();
  }
});

test('the same guest connecting again takes over from their old connection', async () => {
  const { s, r, host, guest, guestToken } = await room();
  try {
    const again = connect(s.base, r.sessionId, guestToken);
    await again.open;
    await settle();
    assert.equal(again.closed(), null, 'not refused as a second guest');
    assert.equal(guest.closed()?.code, 4009);
    assert.equal(host.got.some((m) => m.type === 'presence' && m.role === 'guest' && !m.connected), false, 'the host never sees them leave');
    again.ws.close();
  } finally {
    host.ws.close();
    s.done();
  }
});

test('a finished guest track can’t be changed after the session ends', async () => {
  const { s, r, host, guest, guestToken } = await room();
  try {
    const path = `/api/sessions/${r.sessionId}/tracks/guest`;
    const q = `?token=${guestToken}`;
    const pcm = Buffer.alloc(480, 2);
    const meta = { name: 'Sam', sampleRate: 48000, bitDepth: 16, channels: 1, segments: 1, done: false };
    assert.equal((await s.call(`${path}/segments/100001${q}`, { method: 'PUT', raw: pcm })).status, 400);
    assert.equal((await s.call(`${path}/meta${q}`, { method: 'PUT', body: { ...meta, sampleRate: 1e12 } })).status, 400);
    assert.equal((await s.call(`${path}/segments/1${q}`, { method: 'PUT', raw: pcm })).status, 204);
    assert.equal((await s.call(`${path}/meta${q}`, { method: 'PUT', body: meta })).status, 204);
    await s.call(`/api/sessions/${r.sessionId}/end?token=${r.hostToken}`, { body: {} });
    // Still sending: the last pieces arrive after the host ends.
    assert.equal((await s.call(`${path}/segments/1${q}`, { method: 'PUT', raw: pcm })).status, 204);
    assert.equal((await s.call(`${path}/meta${q}`, { method: 'PUT', body: { ...meta, done: true } })).status, 204);
    // All sent: sealed.
    assert.equal((await s.call(`${path}/segments/1${q}`, { method: 'PUT', raw: Buffer.alloc(480, 9) })).status, 409);
    assert.equal((await s.call(`${path}/meta${q}`, { method: 'PUT', body: { ...meta, done: false } })).status, 409);
    assert.deepEqual((await s.call(`${path}/segments/1${q}`)).buf, pcm);
  } finally {
    host.ws.close();
    guest.ws.close();
    s.done();
  }
});

test('codes stop working after a week', async () => {
  const s = await signedIn();
  try {
    const r = (await s.call('/api/sessions', { body: { episodeId: '142' } })).body;
    s.ctx.db.prepare('UPDATE invites SET created_at = ?').run(Date.now() - 8 * 86_400_000);
    assert.equal((await s.call('/api/join', { body: { code: r.codes.guest } })).status, 404);
    assert.deepEqual(s.ctx.live.session(r.sessionId)!.codes, { guest: null, producer: null });
  } finally {
    s.done();
  }
});
