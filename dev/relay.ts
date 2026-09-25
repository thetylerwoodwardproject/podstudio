/*
 * Dev stand-in for the Podstudio server, as a Vite plugin: `npm run dev` and
 * `npm run preview` serve it next to the app. It implements docs/server-api.md
 * (sessions and 6-digit codes, the live room over WebSocket, guest track
 * uploads), keeping sessions in memory and tracks in .podstudio-dev/. The real
 * server replaces it without changes to the app.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import { Presence, Registry, type InviteRole, type Member, type Role } from './relay-core.ts';

const DATA = join(process.cwd(), '.podstudio-dev');
const registry = new Registry();
const rooms = new Map<string, Presence<WebSocket>>();
/** The latest state and script a host sent, for whoever connects later. */
const latest = new Map<string, Record<string, unknown>>();
/** People waiting to be let in, per session (their sockets get nothing but the answer). */
const lobbies = new Map<string, Map<WebSocket, Member>>();
const lobby = (id: string) => lobbies.get(id) ?? lobbies.set(id, new Map()).get(id)!;
const knockOf = (m: Member) => ({ id: m.id, role: m.role, name: m.name });

function toHosts(sessionId: string, msg: Record<string, unknown>) {
  const text = JSON.stringify(msg);
  for (const [ws, role] of rooms.get(sessionId)?.members ?? []) if (role === 'host' && ws.readyState === WebSocket.OPEN) ws.send(text);
}

const json = (res: ServerResponse, status: number, body?: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const body = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
const bearer = (req: IncomingMessage, url: URL) => req.headers.authorization?.replace(/^Bearer /, '') ?? url.searchParams.get('token');
const segName = (n: number) => `seg-${String(n).padStart(6, '0')}.pcm`;
const isRole = (r: string): r is Role => r === 'host' || r === 'guest' || r === 'producer';

function broadcast(sessionId: string, msg: Record<string, unknown>, except?: WebSocket) {
  const text = JSON.stringify(msg);
  for (const ws of rooms.get(sessionId)?.members.keys() ?? []) if (ws !== except && ws.readyState === WebSocket.OPEN) ws.send(text);
}

async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (!url.pathname.startsWith('/api/')) return next();
  const p = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
  try {
    if (req.method === 'GET' && p[0] === 'health') return json(res, 200, { ok: true, server: 'podstudio-dev-relay', time: Date.now() });

    if (req.method === 'POST' && p[0] === 'join' && p.length === 1) {
      const { code, name } = JSON.parse(String(await body(req)) || '{}');
      const j = registry.join(String(code ?? ''), String(name ?? ''));
      if (!j) return json(res, 404, { error: 'That code isn’t valid. Check it with the host.' });
      return json(res, 200, { sessionId: j.session.id, episodeId: j.session.episodeId, role: j.role, token: j.token, name: j.member.name, admitted: false });
    }

    if (p[0] !== 'sessions') return json(res, 404, { error: 'Not found' });

    if (req.method === 'POST' && p.length === 1) {
      const { episodeId } = JSON.parse(String(await body(req)) || '{}');
      const { session, hostToken } = registry.create(String(episodeId ?? ''));
      return json(res, 200, { sessionId: session.id, hostToken, codes: session.codes });
    }

    const sessionId = p[1];
    const role = registry.auth(sessionId, bearer(req, url));
    if (!role) return json(res, 401, { error: 'Not signed in to this session' });
    const session = registry.sessions.get(sessionId)!;

    // GET /sessions/:id → codes (host and producer) and who's connected
    if (req.method === 'GET' && p.length === 2) {
      return json(res, 200, {
        episodeId: session.episodeId,
        codes: role === 'guest' ? undefined : session.codes,
        connected: rooms.get(sessionId)?.roles() ?? [],
        waiting: role === 'host' ? [...lobby(sessionId).values()].map(knockOf) : undefined,
        ended: session.ended,
      });
    }
    // POST/DELETE /sessions/:id/codes/:role
    if (p[2] === 'codes' && (p[3] === 'guest' || p[3] === 'producer')) {
      if (role === 'guest') return json(res, 403, { error: 'Only the host or producer manages codes' });
      const r = p[3] as InviteRole;
      if (req.method === 'POST') return json(res, 200, { code: registry.newCode(sessionId, r), codes: session.codes });
      if (req.method === 'DELETE') {
        registry.revoke(sessionId, r);
        // Revoking signs them out: close their connections.
        for (const [ws, who] of rooms.get(sessionId)?.members ?? []) if (who === r) ws.close(4003, 'Invite revoked');
        for (const [ws, who] of lobby(sessionId)) if (who.role === r) ws.close(4003, 'Invite revoked');
        return json(res, 200, { codes: session.codes });
      }
    }
    // POST /sessions/:id/end
    if (req.method === 'POST' && p[2] === 'end') {
      if (role !== 'host') return json(res, 403, { error: 'Only the host ends a session' });
      registry.end(sessionId);
      return json(res, 200, {});
    }
    // /sessions/:id/tracks/:role[/meta|/segments/:n]
    if (p[2] === 'tracks' && isRole(p[3] ?? '')) {
      const dir = join(DATA, sessionId, p[3]);
      const own = role === p[3];
      if (p[4] === 'segments' && p[5]) {
        const n = Number(p[5]);
        if (!Number.isInteger(n) || n < 1) return json(res, 400, { error: 'Bad segment number' });
        if (req.method === 'PUT') {
          if (!own) return json(res, 403, { error: 'You can only upload your own track' });
          const data = await body(req);
          // A piece is never empty: refuse it, so the client sends it again once it's saved.
          if (!data.length) return json(res, 400, { error: 'Empty segment' });
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, segName(n)), data);
          broadcast(sessionId, { type: 'upload', role: p[3], segments: n });
          return json(res, 204);
        }
        if (req.method === 'GET') {
          try {
            const data = await readFile(join(dir, segName(n)));
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/octet-stream');
            return res.end(data);
          } catch {
            return json(res, 404, { error: 'No such segment' });
          }
        }
      }
      if (p[4] === 'meta') {
        if (req.method === 'PUT') {
          if (!own) return json(res, 403, { error: 'You can only describe your own track' });
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, 'meta.json'), await body(req));
          return json(res, 204);
        }
      }
      if (req.method === 'GET' && p.length === 4) {
        let meta = null;
        let segments = 0;
        try {
          meta = JSON.parse(String(await readFile(join(dir, 'meta.json'))));
        } catch {}
        try {
          segments = (await readdir(dir)).filter((f) => f.startsWith('seg-')).length;
        } catch {}
        return json(res, 200, { meta, segments });
      }
    }
    return json(res, 404, { error: 'Not found' });
  } catch (err) {
    return json(res, 500, { error: (err as Error).message });
  }
}

/** Into the live room: catch up on the host's latest, and tell everyone. */
function enter(ws: WebSocket, sessionId: string, member: Member) {
  const room = rooms.get(sessionId) ?? new Presence<WebSocket>();
  rooms.set(sessionId, room);
  const refused = room.canJoin(member.role);
  if (refused) return ws.close(4009, refused);
  room.add(ws, member.role);
  for (const m of Object.values(latest.get(sessionId) ?? {})) ws.send(JSON.stringify(m));
  if (member.role === 'host') ws.send(JSON.stringify({ type: 'knocks', members: [...lobby(sessionId).values()].map(knockOf) }));
  broadcast(sessionId, { type: 'presence', role: member.role, name: member.name, connected: true, roles: room.roles() });
  ws.on('message', (data) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.type === 'ping') return ws.send(JSON.stringify({ type: 'pong', t: msg.t, server: Date.now() }));
    // Only the host lets people in or turns them away.
    if ((msg.type === 'admit' || msg.type === 'deny') && member.role === 'host') return answer(sessionId, String(msg.id), msg.type, ws);
    if (msg.type === 'admit' || msg.type === 'deny') return;
    msg.from = member.role;
    if (msg.type === 'state' || msg.type === 'script' || msg.type === 'setup') {
      latest.set(sessionId, { ...latest.get(sessionId), [msg.type as string]: msg });
    }
    broadcast(sessionId, msg, ws);
  });
  ws.on('close', () => {
    room.remove(ws);
    broadcast(sessionId, { type: 'presence', role: member.role, name: member.name, connected: false, roles: room.roles() });
  });
}

function answer(sessionId: string, memberId: string, verdict: 'admit' | 'deny', host: WebSocket) {
  const waiting = [...lobby(sessionId)].find(([, m]) => m.id === memberId);
  if (verdict === 'deny') {
    registry.deny(sessionId, memberId);
    if (waiting) {
      lobby(sessionId).delete(waiting[0]);
      waiting[0].close(4003, 'The host didn’t let you in');
    }
    return toHosts(sessionId, { type: 'knock-gone', id: memberId });
  }
  const r = registry.admit(sessionId, memberId);
  if (typeof r === 'string') return host.send(JSON.stringify({ type: 'admit-error', id: memberId, error: r }));
  toHosts(sessionId, { type: 'knock-gone', id: memberId });
  if (!waiting) return;
  lobby(sessionId).delete(waiting[0]);
  waiting[0].removeAllListeners('message');
  waiting[0].removeAllListeners('close');
  waiting[0].send(JSON.stringify({ type: 'admitted' }));
  enter(waiting[0], sessionId, r);
}

function attachSockets(server: Server | null | undefined) {
  if (!server) return;
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/api/ws') return; // Vite's own HMR socket
    const sessionId = url.searchParams.get('session') ?? '';
    const member = registry.member(sessionId, url.searchParams.get('token'));
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!member) return ws.close(4001, 'Not signed in to this session');
      if (member.admitted) return enter(ws, sessionId, member);
      // The waiting room: the host is asked, and nothing else reaches them until they're let in.
      lobby(sessionId).set(ws, member);
      ws.send(JSON.stringify({ type: 'waiting' }));
      toHosts(sessionId, { type: 'knock', member: knockOf(member) });
      ws.on('message', (data) => {
        try {
          if (JSON.parse(String(data)).type === 'ping') ws.send(JSON.stringify({ type: 'pong', t: JSON.parse(String(data)).t, server: Date.now() }));
        } catch {}
      });
      ws.on('close', () => {
        if (lobby(sessionId).delete(ws)) toHosts(sessionId, { type: 'knock-gone', id: member.id });
      });
    });
  });
}

export function relay(): Plugin {
  return {
    name: 'podstudio-dev-relay',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handle(req, res, next));
      attachSockets(server.httpServer as Server | null);
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handle(req, res, next));
      attachSockets(server.httpServer as Server | null);
    },
  };
}
