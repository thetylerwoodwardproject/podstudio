/*
 * The dev stand-in for the Podstudio server: sessions, 6-digit invite codes
 * and who may connect. Pure logic, no I/O, so it can be tested; dev/relay.ts
 * puts HTTP and WebSockets around it. The API it serves is docs/server-api.md.
 */
import { randomBytes, randomInt } from 'node:crypto';

export type Role = 'host' | 'guest' | 'producer';
export type InviteRole = Exclude<Role, 'host'>;

/**
 * Someone holding a token for a session. Guests and producers start out
 * waiting (like a Zoom waiting room) until the host lets them in.
 */
export interface Member {
  id: string;
  role: Role;
  name: string;
  admitted: boolean;
}

export interface Session {
  id: string;
  episodeId: string;
  codes: Record<InviteRole, string | null>;
  /** token → member */
  tokens: Map<string, Member>;
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
    s.tokens.set(hostToken, { id: token().slice(0, 8), role: 'host', name: 'Host', admitted: true });
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
    for (const [t, m] of s.tokens) if (m.role === role) s.tokens.delete(t);
  }

  /** A code and a name get a token that waits for the host to let them in. */
  join(code: string, name = ''): { session: Session; role: InviteRole; token: string; member: Member } | null {
    if (!/^\d{6}$/.test(code)) return null;
    for (const s of this.sessions.values()) {
      if (s.ended) continue;
      for (const role of ['guest', 'producer'] as const) {
        if (s.codes[role] === code) {
          const t = token();
          const member: Member = { id: token().slice(0, 8), role, name: name.trim().slice(0, 40) || (role === 'guest' ? 'Guest' : 'Producer'), admitted: false };
          s.tokens.set(t, member);
          return { session: s, role, token: t, member };
        }
      }
    }
    return null;
  }

  /** The member a token belongs to, admitted or still waiting. */
  member(sessionId: string, t: string | null | undefined): Member | null {
    const s = this.sessions.get(sessionId);
    return (t && s?.tokens.get(t)) || null;
  }

  /** The role of an admitted member; waiting members get null. */
  auth(sessionId: string, t: string | null | undefined): Role | null {
    const m = this.member(sessionId, t);
    return m?.admitted ? m.role : null;
  }

  waiting(sessionId: string): Member[] {
    return [...(this.sessions.get(sessionId)?.tokens.values() ?? [])].filter((m) => !m.admitted);
  }

  /** The host lets someone in. Only one guest at a time. */
  admit(sessionId: string, memberId: string): Member | string {
    const s = this.get(sessionId);
    const m = [...s.tokens.values()].find((x) => x.id === memberId);
    if (!m) return 'They’ve already left';
    if (m.role === 'guest' && [...s.tokens.values()].some((x) => x.role === 'guest' && x.admitted && x !== m)) return 'A guest is already in the session';
    m.admitted = true;
    return m;
  }

  /** The host turns someone away: their token stops working. */
  deny(sessionId: string, memberId: string) {
    const s = this.get(sessionId);
    for (const [t, m] of s.tokens) if (m.id === memberId && !m.admitted) s.tokens.delete(t);
  }

  /** Remove someone already in (a second guest replacing the first, say). */
  remove(sessionId: string, memberId: string) {
    const s = this.get(sessionId);
    for (const [t, m] of s.tokens) if (m.id === memberId && m.role !== 'host') s.tokens.delete(t);
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
