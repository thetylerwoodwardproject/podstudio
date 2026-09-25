/*
 * The live session between host, guest and producer, through the Podstudio
 * server (for now the dev stand-in in dev/relay.ts; the API is
 * docs/server-api.md). The host's recording screen is the authority: it sends
 * the session state, and the guest and producer send it commands and status.
 */
import type { SessionMarker } from './audio/assemble';

export type Role = 'host' | 'guest' | 'producer';
/** What the script is for this show: speaker lines, host only (guest free), talking points, or none. */
export type ScriptMode = 'lines' | 'host' | 'points' | 'adlib';

export interface SessionState {
  recording: boolean;
  paused: boolean;
  ended: boolean;
  /** Server clock (ms) when recording started */
  startedAtServer: number | null;
  word: number;
  line: number;
  /** Current talking point */
  point: number;
  markers: SessionMarker[];
  scriptVersion: number;
  mode: ScriptMode;
  hostName: string;
  /** An ad-lib or cough cut is running (for the producer's buttons) */
  adlib: boolean;
  cut: boolean;
}

export type Command =
  | { action: 'start' | 'pause' | 'resume' | 'stop' | 'retake' | 'adlib' | 'cut' | 'next' | 'prev' }
  | { action: 'goto'; word: number }
  | { action: 'section'; index: number }
  | { action: 'point'; index: number }
  /** The guest holds Cough on their own screen */
  | { action: 'cough'; down: boolean };

export interface GuestStatus {
  name: string;
  level?: number;
  /** Peak of the last 250 ms, dBFS, for the host's mixer */
  now?: number;
  clip?: boolean;
  recording?: boolean;
  /** Segments uploaded, and waiting to upload */
  uploaded?: number;
  pending?: number;
  done?: boolean;
  mic?: string;
  /** Voice follow on the guest's own lines: the word they're on */
  word?: number;
  /** The guest's recording, for aligning and fetching */
  take?: { sampleRate: number; bitDepth: 16 | 24; channels: 1 | 2; startedAtServer: number | null; segments: number };
}

export type RoomMessage = (
  | { type: 'state'; state: SessionState }
  | { type: 'script'; version: number; text: string }
  | ({ type: 'command' } & Command)
  | ({ type: 'guest' } & GuestStatus)
  | { type: 'presence'; role: Role; connected: boolean; roles: Role[] }
  | { type: 'upload'; role: Role; segments: number }
  | { type: 'hello'; role: Role; name?: string }
  /** Waiting room: someone knocking, everyone waiting (sent to the host), and the answer */
  | { type: 'knock'; member: Knock }
  | { type: 'knocks'; members: Knock[] }
  | { type: 'knock-gone'; id: string }
  | { type: 'admit' | 'deny'; id: string }
  | { type: 'admit-error'; id: string; error: string }
  | { type: 'waiting' }
  | { type: 'admitted' }
  /** From the host: how the show is set up, and the talking points */
  | { type: 'setup'; mode: ScriptMode; points: string[]; hostName: string; guestName?: string }
) & { from?: Role };

/** Someone waiting to be let in. */
export interface Knock {
  id: string;
  role: 'guest' | 'producer';
  name: string;
}

export interface Membership {
  sessionId: string;
  token: string;
  role: Role;
  episodeId: string;
  name?: string;
}

// ── HTTP API ──────────────────────────────────────────────────────────────────

async function api<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...init.headers },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
  return body as T;
}

/** Whether a Podstudio server (or the dev stand-in) is there to connect people. */
export async function serverAvailable(): Promise<boolean> {
  try {
    return (await api<{ ok: boolean }>('health')).ok;
  } catch {
    return false;
  }
}

export interface Codes {
  guest: string | null;
  producer: string | null;
}

export async function createSession(episodeId: string) {
  return api<{ sessionId: string; hostToken: string; codes: Codes }>('sessions', { method: 'POST', body: JSON.stringify({ episodeId }) });
}

export async function sessionInfo(m: Membership) {
  return api<{ episodeId: string; codes?: Codes; connected: Role[]; ended: boolean }>(`sessions/${m.sessionId}`, { token: m.token });
}

export async function newCode(m: Membership, role: 'guest' | 'producer') {
  return api<{ code: string; codes: Codes }>(`sessions/${m.sessionId}/codes/${role}`, { method: 'POST', token: m.token });
}

export async function revokeCode(m: Membership, role: 'guest' | 'producer') {
  return api<{ codes: Codes }>(`sessions/${m.sessionId}/codes/${role}`, { method: 'DELETE', token: m.token });
}

/** Join with a code and a name. The host still has to let them in (see Room: 'waiting', 'admitted'). */
export async function joinWithCode(code: string, name: string): Promise<Membership & { name: string }> {
  return api<Membership & { name: string }>('join', { method: 'POST', body: JSON.stringify({ code: code.replace(/\D/g, ''), name }) });
}

export async function endSession(m: Membership) {
  return api(`sessions/${m.sessionId}/end`, { method: 'POST', token: m.token });
}

export async function uploadSegment(m: Membership, role: Role, n: number, data: Blob) {
  const res = await fetch(`/api/sessions/${m.sessionId}/tracks/${role}/segments/${n}`, {
    method: 'PUT',
    body: data,
    headers: { Authorization: `Bearer ${m.token}`, 'Content-Type': 'application/octet-stream' },
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

export async function uploadTrackMeta(m: Membership, role: Role, meta: unknown) {
  await api(`sessions/${m.sessionId}/tracks/${role}/meta`, { method: 'PUT', token: m.token, body: JSON.stringify(meta) });
}

export async function trackInfo(m: Membership, role: Role) {
  return api<{ meta: Record<string, unknown> | null; segments: number }>(`sessions/${m.sessionId}/tracks/${role}`, { token: m.token });
}

export async function fetchSegment(m: Membership, role: Role, n: number): Promise<ArrayBuffer> {
  const res = await fetch(`/api/sessions/${m.sessionId}/tracks/${role}/segments/${n}`, { headers: { Authorization: `Bearer ${m.token}` } });
  if (!res.ok) throw new Error(`Couldn’t fetch piece ${n} (${res.status})`);
  return res.arrayBuffer();
}

// ── Who this browser is in a session ──────────────────────────────────────────

const hostKey = (episodeId: string) => `podstudio:session:${episodeId}`;
const JOIN_KEY = 'podstudio:join';

/** The host's session for an episode (kept per browser). */
export function hostMembership(episodeId: string): (Membership & { codes: Codes }) | null {
  try {
    return JSON.parse(localStorage.getItem(hostKey(episodeId)) || 'null');
  } catch {
    return null;
  }
}
export function saveHostMembership(episodeId: string, m: (Membership & { codes: Codes }) | null) {
  try {
    if (m) localStorage.setItem(hostKey(episodeId), JSON.stringify(m));
    else localStorage.removeItem(hostKey(episodeId));
  } catch {}
}

/** A guest's or producer's session, joined with a code (kept for this tab). */
export function joined(): Membership | null {
  try {
    return JSON.parse(sessionStorage.getItem(JOIN_KEY) || 'null');
  } catch {
    return null;
  }
}
export function saveJoined(m: Membership | null) {
  try {
    if (m) sessionStorage.setItem(JOIN_KEY, JSON.stringify(m));
    else sessionStorage.removeItem(JOIN_KEY);
  } catch {}
}

// ── Clock ─────────────────────────────────────────────────────────────────────

export interface ClockSample {
  sent: number;
  received: number;
  server: number;
}

/**
 * The server clock minus ours (ms), from ping round trips: the quickest round
 * trip is the least delayed, and the server read its clock about halfway through.
 */
export function bestOffset(samples: ClockSample[]): number {
  if (!samples.length) return 0;
  const best = samples.reduce((a, b) => (b.received - b.sent < a.received - a.sent ? b : a));
  return best.server - (best.sent + best.received) / 2;
}

// ── The live room ─────────────────────────────────────────────────────────────

/** A WebSocket to the session's room that reconnects on its own and keeps a server-clock offset. */
export class Room extends EventTarget {
  readonly m: Membership;
  private ws: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private samples: ClockSample[] = [];
  private queue: string[] = [];
  /** Server clock minus local clock, ms */
  offset = 0;
  connected = false;
  /** Why the server closed the connection for good (revoked, turned away, a guest already there) */
  refused = '';
  /** Still in the waiting room */
  waiting = false;

  constructor(m: Membership) {
    super();
    this.m = m;
  }

  connect() {
    if (this.closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/ws?session=${encodeURIComponent(this.m.sessionId)}&token=${encodeURIComponent(this.m.token)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.retry = 0;
      this.emit('open');
      for (const q of this.queue.splice(0)) ws.send(q);
      this.sync();
    };
    ws.onmessage = (e) => {
      let msg: RoomMessage & { t?: number; server?: number };
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (msg.type === 'waiting') this.waiting = true;
      if (msg.type === 'admitted') this.waiting = false;
      if ((msg as { type: string }).type === 'pong') {
        this.samples.push({ sent: msg.t!, received: Date.now(), server: msg.server! });
        this.offset = bestOffset(this.samples.slice(-16));
        return;
      }
      this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
      this.dispatchEvent(new CustomEvent('message', { detail: msg }));
    };
    ws.onclose = (e) => {
      this.connected = false;
      this.emit('close', e.reason);
      // 4001 not signed in, 4003 revoked, 4009 refused: don't keep knocking.
      if ([4001, 4003, 4009].includes(e.code)) {
        this.refused = e.reason || 'The session refused this connection';
        this.closed = true;
        this.emit('refused', this.refused);
        return;
      }
      if (!this.closed) setTimeout(() => this.connect(), Math.min(10000, 500 * 2 ** this.retry++));
    };
  }

  /** Measure the clock offset: 8 pings, a little apart, and again every minute. */
  private sync() {
    for (let i = 0; i < 8; i++) setTimeout(() => this.ping(), i * 150);
    setTimeout(() => this.connected && this.sync(), 60000);
  }

  private ping() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
  }

  /** The server's clock now, in ms. */
  serverNow() {
    return Date.now() + this.offset;
  }

  send(msg: RoomMessage) {
    const text = JSON.stringify(msg);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(text);
    else if (msg.type !== 'guest' && msg.type !== 'state') this.queue.push(text); // status is resent anyway
  }

  on<T extends RoomMessage['type']>(type: T, fn: (msg: Extract<RoomMessage, { type: T }>) => void) {
    this.addEventListener(type, (e) => fn((e as CustomEvent).detail));
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }

  /** Host only: let someone in from the waiting room, or turn them away. */
  admit(id: string) {
    this.send({ type: 'admit', id });
  }
  deny(id: string) {
    this.send({ type: 'deny', id });
  }

  private emit(type: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
