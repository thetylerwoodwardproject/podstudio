/*
 * Live sessions over HTTP and WebSocket (docs/server-api.md): create a
 * session, invite codes, join, the waiting room, the live room, and the
 * guest's track uploads. Sessions and tokens are in the database (live-store);
 * who's connected right now, and the host's latest state, are in memory.
 */
import { existsSync } from 'node:fs';
import { rm, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type { Context } from './context.ts';
import { HttpError, RateLimit, SEGMENT_LIMIT, clientIp, json, readBody, readJson, streamToFile } from './http.ts';
import { Presence, type InviteRole, type Member, type Role } from './live-store.ts';

const segName = (n: number) => `seg-${String(n).padStart(6, '0')}.pcm`;
const isRole = (r: string): r is Role => r === 'host' || r === 'guest' || r === 'producer';
const bearer = (req: IncomingMessage, url: URL) => req.headers.authorization?.replace(/^Bearer /, '') ?? url.searchParams.get('token');
const knockOf = (m: Member) => ({ id: m.id, role: m.role, name: m.name });

export class LiveRooms {
  private ctx: Context;
  private rooms = new Map<string, Presence<WebSocket>>();
  /** The latest state, script and setup a host sent, for whoever connects later */
  private latest = new Map<string, Record<string, unknown>>();
  /** People waiting to be let in (their sockets get nothing but the answer) */
  private lobbies = new Map<string, Map<WebSocket, Member>>();
  /** Codes are 6 digits: limit tries per address so they can't be guessed */
  private joins = new RateLimit(20, 10 * 60_000);
  /** Whether the host making a session is signed in (set by the auth layer) */
  canHost: (req: IncomingMessage) => boolean = () => true;

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  private get store() {
    return this.ctx.live;
  }
  private lobby(id: string) {
    return this.lobbies.get(id) ?? this.lobbies.set(id, new Map()).get(id)!;
  }
  private trackDir(sessionId: string, role: Role) {
    return join(this.ctx.config.data, 'live', sessionId, role);
  }
  private toHosts(sessionId: string, msg: Record<string, unknown>) {
    const text = JSON.stringify(msg);
    for (const [ws, role] of this.rooms.get(sessionId)?.members ?? []) if (role === 'host' && ws.readyState === WebSocket.OPEN) ws.send(text);
  }
  private broadcast(sessionId: string, msg: Record<string, unknown>, except?: WebSocket) {
    const text = JSON.stringify(msg);
    for (const ws of this.rooms.get(sessionId)?.members.keys() ?? []) if (ws !== except && ws.readyState === WebSocket.OPEN) ws.send(text);
  }

  /** Handles /api/join and /api/sessions/**; false for anything else. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL, p: string[]): Promise<boolean> {
    if (req.method === 'POST' && p[0] === 'join' && p.length === 1) {
      if (!this.joins.hit(clientIp(req))) throw new HttpError(429, 'Too many tries. Wait a few minutes, then check the code with the host.');
      const { code, name } = await readJson<{ code?: string; name?: string }>(req);
      const j = this.store.join(String(code ?? ''), String(name ?? ''));
      if (!j) throw new HttpError(404, 'That code isn’t valid. Check it with the host.');
      json(res, 200, { sessionId: j.session.id, episodeId: j.session.episodeId, role: j.role, token: j.token, name: j.member.name, admitted: false });
      return true;
    }
    if (p[0] !== 'sessions') return false;

    if (req.method === 'POST' && p.length === 1) {
      if (!this.canHost(req)) throw new HttpError(401, 'Sign in to start a session');
      const { episodeId } = await readJson<{ episodeId?: string }>(req);
      const { session, hostToken } = this.store.create(String(episodeId ?? ''));
      json(res, 200, { sessionId: session.id, hostToken, codes: session.codes });
      return true;
    }

    const sessionId = p[1];
    const role = this.store.auth(sessionId, bearer(req, url));
    if (!role) throw new HttpError(401, 'Not signed in to this session');
    const session = this.store.session(sessionId)!;

    // GET /sessions/:id → codes (host and producer), who's connected, who's waiting
    if (req.method === 'GET' && p.length === 2) {
      json(res, 200, {
        episodeId: session.episodeId,
        codes: role === 'guest' ? undefined : session.codes,
        connected: this.rooms.get(sessionId)?.roles() ?? [],
        waiting: role === 'host' ? [...this.lobby(sessionId).values()].map(knockOf) : undefined,
        ended: session.ended,
      });
      return true;
    }
    // POST/DELETE /sessions/:id/codes/:role
    if (p[2] === 'codes' && (p[3] === 'guest' || p[3] === 'producer')) {
      if (role === 'guest') throw new HttpError(403, 'Only the host or producer manages codes');
      const r = p[3] as InviteRole;
      if (req.method === 'POST') {
        const code = this.store.newCode(sessionId, r);
        json(res, 200, { code, codes: this.store.session(sessionId)!.codes });
        return true;
      }
      if (req.method === 'DELETE') {
        this.store.revoke(sessionId, r);
        // Revoking signs them out: close their connections.
        for (const [ws, who] of this.rooms.get(sessionId)?.members ?? []) if (who === r) ws.close(4003, 'Invite revoked');
        for (const [ws, who] of this.lobby(sessionId)) if (who.role === r) ws.close(4003, 'Invite revoked');
        json(res, 200, { codes: this.store.session(sessionId)!.codes });
        return true;
      }
    }
    // POST /sessions/:id/end
    if (req.method === 'POST' && p[2] === 'end') {
      if (role !== 'host') throw new HttpError(403, 'Only the host ends a session');
      this.store.end(sessionId);
      json(res, 200, {});
      return true;
    }
    // /sessions/:id/tracks/:role[/meta|/segments/:n]
    if (p[2] === 'tracks' && isRole(p[3] ?? '')) {
      if (this.ctx.recordings.deletedLive(sessionId)) throw new HttpError(410, 'This recording was permanently deleted');
      const dir = this.trackDir(sessionId, p[3] as Role);
      const own = role === p[3];
      if (p[4] === 'segments' && p[5]) {
        const n = Number(p[5]);
        if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Bad segment number');
        if (req.method === 'PUT') {
          if (!own) throw new HttpError(403, 'You can only upload your own track');
          await mkdir(dir, { recursive: true });
          // A piece is never empty: refused, so the client sends it again once it's saved.
          await streamToFile(req, join(dir, segName(n)), SEGMENT_LIMIT).catch((err) => {
            throw err instanceof HttpError && err.message === 'Empty body' ? new HttpError(400, 'Empty segment') : err;
          });
          if (this.ctx.recordings.deletedLive(sessionId)) { await rm(dir, {recursive:true, force:true}); throw new HttpError(410, 'This recording was permanently deleted'); }
          this.broadcast(sessionId, { type: 'upload', role: p[3], segments: n });
          json(res, 204);
          return true;
        }
        if (req.method === 'GET') {
          const file = join(dir, segName(n));
          if (!existsSync(file)) throw new HttpError(404, 'No such segment');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/octet-stream');
          res.end(await readFile(file));
          return true;
        }
      }
      if (p[4] === 'meta' && req.method === 'PUT') {
        if (!own) throw new HttpError(403, 'You can only describe your own track');
        const body = await readBody(req, 1 << 20);
        JSON.parse(String(body));
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'meta.json'), body);
        if (this.ctx.recordings.deletedLive(sessionId)) { await rm(dir, {recursive:true,force:true}); throw new HttpError(410, 'This recording was permanently deleted'); }
        json(res, 204);
        return true;
      }
      if (req.method === 'GET' && p.length === 4) {
        let meta = null;
        let segments = 0;
        try {
          meta = JSON.parse(String(await readFile(join(dir, 'meta.json'))));
        } catch {}
        try {
          segments = (await readdir(dir)).filter((f) => /^seg-\d+\.pcm$/.test(f)).length;
        } catch {}
        json(res, 200, { meta, segments });
        return true;
      }
    }
    throw new HttpError(404, 'Not found');
  }

  /** Into the live room: catch up on the host's latest, and tell everyone. */
  private enter(ws: WebSocket, sessionId: string, member: Member) {
    const room = this.rooms.get(sessionId) ?? new Presence<WebSocket>();
    this.rooms.set(sessionId, room);
    const refused = room.canJoin(member.role);
    if (refused) return ws.close(4009, refused);
    room.add(ws, member.role);
    for (const m of Object.values(this.latest.get(sessionId) ?? {})) ws.send(JSON.stringify(m));
    if (member.role === 'host') ws.send(JSON.stringify({ type: 'knocks', members: [...this.lobby(sessionId).values()].map(knockOf) }));
    this.broadcast(sessionId, { type: 'presence', role: member.role, name: member.name, connected: true, roles: room.roles() });
    ws.on('message', (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.type === 'ping') return ws.send(JSON.stringify({ type: 'pong', t: msg.t, server: Date.now() }));
      // Only the host lets people in or turns them away.
      if ((msg.type === 'admit' || msg.type === 'deny') && member.role === 'host') return this.answer(sessionId, String(msg.id), msg.type, ws);
      if (msg.type === 'admit' || msg.type === 'deny') return;
      msg.from = member.role;
      if (msg.type === 'state' || msg.type === 'script' || msg.type === 'setup') {
        this.latest.set(sessionId, { ...this.latest.get(sessionId), [msg.type as string]: msg });
      }
      this.broadcast(sessionId, msg, ws);
    });
    ws.on('close', () => {
      room.remove(ws);
      if (!room.members.size) this.rooms.delete(sessionId);
      this.broadcast(sessionId, { type: 'presence', role: member.role, name: member.name, connected: false, roles: room.roles() });
    });
  }

  private answer(sessionId: string, memberId: string, verdict: 'admit' | 'deny', host: WebSocket) {
    const waiting = [...this.lobby(sessionId)].find(([, m]) => m.id === memberId);
    if (verdict === 'deny') {
      this.store.deny(sessionId, memberId);
      if (waiting) {
        this.lobby(sessionId).delete(waiting[0]);
        waiting[0].close(4003, 'The host didn’t let you in');
      }
      return this.toHosts(sessionId, { type: 'knock-gone', id: memberId });
    }
    const r = this.store.admit(sessionId, memberId);
    if (typeof r === 'string') return host.send(JSON.stringify({ type: 'admit-error', id: memberId, error: r }));
    this.toHosts(sessionId, { type: 'knock-gone', id: memberId });
    if (!waiting) return;
    this.lobby(sessionId).delete(waiting[0]);
    waiting[0].removeAllListeners('message');
    waiting[0].removeAllListeners('close');
    waiting[0].send(JSON.stringify({ type: 'admitted' }));
    this.enter(waiting[0], sessionId, r);
  }

  /** Take over /api/ws upgrades on an HTTP server (other upgrades, like Vite's, are left alone). */
  attach(server: Server | null | undefined) {
    if (!server) return;
    const wss = new WebSocketServer({ noServer: true, maxPayload: 256 << 10 });
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname !== '/api/ws') return;
      const sessionId = url.searchParams.get('session') ?? '';
      const member = this.store.member(sessionId, url.searchParams.get('token'));
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (!member) return ws.close(4001, 'Not signed in to this session');
        if (member.admitted) return this.enter(ws, sessionId, member);
        // The waiting room: the host is asked, and nothing else reaches them until they're let in.
        this.lobby(sessionId).set(ws, member);
        ws.send(JSON.stringify({ type: 'waiting' }));
        this.toHosts(sessionId, { type: 'knock', member: knockOf(member) });
        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(String(data));
            if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong', t: msg.t, server: Date.now() }));
          } catch {}
        });
        ws.on('close', () => {
          if (this.lobby(sessionId).delete(ws)) this.toHosts(sessionId, { type: 'knock-gone', id: member.id });
        });
      });
    });
  }
}
