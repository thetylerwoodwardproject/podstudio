/*
 * The dev stand-in for the Podstudio server: sessions, 6-digit invite codes
 * and who may connect. Pure logic, no I/O, so it can be tested; dev/relay.ts
 * puts HTTP and WebSockets around it. The API it serves is docs/server-api.md.
 */
import { randomBytes, randomInt } from 'node:crypto';

export type Role = 'host' | 'guest' | 'producer';
export type InviteRole = Exclude<Role, 'host'>;

export interface Session {
  id: string;
  episodeId: string;
  codes: Record<InviteRole, string | null>;
  /** token → role */
  tokens: Map<string, Role>;
  ended: boolean;
}

const token = () => randomBytes(16).toString('hex');

export class Registry {
  readonly sessions = new Map<string, Session>();
  private code: () => string;

  constructor(code = () => String(randomInt(0, 1_000_000)).padStart(6, '0')) {
    this.code = code;
  }

  create(episodeId: string) {
    const s: Session = { id: token().slice(0, 12), episodeId, codes: { guest: null, producer: null }, tokens: new Map(), ended: false };
    const hostToken = token();
    s.tokens.set(hostToken, 'host');
    this.sessions.set(s.id, s);
    this.newCode(s.id, 'guest');
    this.newCode(s.id, 'producer');
    return { session: s, hostToken };
  }

  /** A fresh code for a role; the old one stops working. Codes are unique across open sessions. */
  newCode(sessionId: string, role: InviteRole): string {
    const s = this.get(sessionId);
    const taken = new Set([...this.sessions.values()].flatMap((x) => Object.values(x.codes)));
    let c = this.code();
    for (let i = 0; taken.has(c) && i < 1000; i++) c = this.code();
    if (taken.has(c)) throw new Error('No free codes');
    s.codes[role] = c;
    return c;
  }

  revoke(sessionId: string, role: InviteRole) {
    this.get(sessionId).codes[role] = null;
    // Whoever joined with it is signed out too.
    const s = this.get(sessionId);
    for (const [t, r] of s.tokens) if (r === role) s.tokens.delete(t);
  }

  join(code: string): { session: Session; role: InviteRole; token: string } | null {
    if (!/^\d{6}$/.test(code)) return null;
    for (const s of this.sessions.values()) {
      if (s.ended) continue;
      for (const role of ['guest', 'producer'] as const) {
        if (s.codes[role] === code) {
          const t = token();
          s.tokens.set(t, role);
          return { session: s, role, token: t };
        }
      }
    }
    return null;
  }

  auth(sessionId: string, t: string | null | undefined): Role | null {
    const s = this.sessions.get(sessionId);
    return (t && s?.tokens.get(t)) || null;
  }

  end(sessionId: string) {
    const s = this.get(sessionId);
    s.ended = true;
    s.codes = { guest: null, producer: null };
  }

  private get(id: string) {
    const s = this.sessions.get(id);
    if (!s) throw new Error('No such session');
    return s;
  }
}

/** Who's connected to a session's live room. Only one guest at a time. */
export class Presence<T> {
  readonly members = new Map<T, Role>();

  canJoin(role: Role): string | null {
    if (role === 'guest' && [...this.members.values()].includes('guest')) return 'A guest is already connected';
    return null;
  }

  add(member: T, role: Role) {
    this.members.set(member, role);
  }

  remove(member: T) {
    this.members.delete(member);
  }

  roles(): Role[] {
    return [...this.members.values()];
  }
}
