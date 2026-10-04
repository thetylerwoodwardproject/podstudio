/*
 * Live sessions with a guest and a producer, kept in the database so a
 * restart keeps them: sessions, 6-digit invite codes, and who holds a token
 * (waiting in the lobby until the host lets them in). The rules are the dev
 * relay's (dev/relay-core.ts); tokens are stored hashed.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { Db } from './db.ts';

export type Role = 'host' | 'guest' | 'producer';
export type InviteRole = Exclude<Role, 'host'>;

export interface Member {
  id: string;
  role: Role;
  name: string;
  admitted: boolean;
}

export interface LiveSession {
  id: string;
  episodeId: string;
  codes: Record<InviteRole, string | null>;
  ended: boolean;
  endedAt: number | null;
}

/** A code works for a week: one the host made and forgot doesn't stay guessable for ever. */
export const CODE_TTL = 7 * 86_400_000;

const token = () => randomBytes(16).toString('hex');
export const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const rowMember = (r: { id: string; role: Role; name: string; admitted: number }): Member => ({ id: r.id, role: r.role, name: r.name, admitted: !!r.admitted });

export class LiveStore {
  private db: Db;
  private code: () => string;

  constructor(db: Db, code = () => String(randomInt(0, 1_000_000)).padStart(6, '0')) {
    this.db = db;
    this.code = code;
  }

  /** A new session for an episode, with a host token and both codes. */
  create(episodeId: string): { session: LiveSession; hostToken: string } {
    const id = token().slice(0, 12);
    const hostToken = token();
    this.db.prepare('INSERT INTO live_sessions (id, episode_id, created_at) VALUES (?, ?, ?)').run(id, episodeId, Date.now());
    this.addMember(id, hostToken, 'host', 'Host', true);
    this.newCode(id, 'guest');
    this.newCode(id, 'producer');
    return { session: this.session(id)!, hostToken };
  }

  session(id: string): LiveSession | null {
    const s = this.db.prepare('SELECT id, episode_id, ended, ended_at FROM live_sessions WHERE id = ?').get(id) as { id: string; episode_id: string; ended: number; ended_at: number | null } | undefined;
    if (!s) return null;
    this.expire();
    const codes: Record<InviteRole, string | null> = { guest: null, producer: null };
    for (const r of this.db.prepare('SELECT role, code FROM invites WHERE session_id = ?').all(id) as { role: InviteRole; code: string }[]) codes[r.role] = r.code;
    return { id: s.id, episodeId: s.episode_id, codes, ended: !!s.ended, endedAt: s.ended_at };
  }

  /** Codes older than a week stop working; the host makes a new one. */
  private expire() {
    this.db.prepare('DELETE FROM invites WHERE created_at <= ?').run(Date.now() - CODE_TTL);
  }

  /** A fresh code for a role; the old one stops working. Codes are unique across open sessions. */
  newCode(sessionId: string, role: InviteRole): string {
    this.get(sessionId);
    const taken = this.db.prepare('SELECT 1 FROM invites WHERE code = ?');
    let c = this.code();
    for (let i = 0; taken.get(c) && i < 1000; i++) c = this.code();
    if (taken.get(c)) throw new Error('No free codes');
    this.db.prepare('INSERT INTO invites (session_id, role, code, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (session_id, role) DO UPDATE SET code = excluded.code, created_at = excluded.created_at').run(sessionId, role, c, Date.now());
    return c;
  }

  /** The code stops working, and whoever joined with it is signed out. */
  revoke(sessionId: string, role: InviteRole) {
    this.get(sessionId);
    this.db.prepare('DELETE FROM invites WHERE session_id = ? AND role = ?').run(sessionId, role);
    this.db.prepare('DELETE FROM members WHERE session_id = ? AND role = ?').run(sessionId, role);
  }

  /** A code and a name get a token that waits for the host to let them in. */
  join(code: string, name = ''): { session: LiveSession; role: InviteRole; token: string; member: Member } | null {
    if (!/^\d{6}$/.test(code)) return null;
    this.expire();
    const row = this.db.prepare('SELECT i.session_id AS sid, i.role AS role FROM invites i JOIN live_sessions s ON s.id = i.session_id WHERE i.code = ? AND s.ended = 0').get(code) as { sid: string; role: InviteRole } | undefined;
    if (!row) return null;
    const t = token();
    const member = this.addMember(row.sid, t, row.role, name.trim().slice(0, 40) || (row.role === 'guest' ? 'Guest' : 'Producer'), false);
    return { session: this.session(row.sid)!, role: row.role, token: t, member };
  }

  /** The member a token belongs to, admitted or still waiting. */
  member(sessionId: string, t: string | null | undefined): Member | null {
    if (!t) return null;
    const r = this.db.prepare('SELECT id, role, name, admitted FROM members WHERE session_id = ? AND token_hash = ?').get(sessionId, hash(t)) as Parameters<typeof rowMember>[0] | undefined;
    return r ? rowMember(r) : null;
  }

  /** The role of an admitted member; waiting members get null. */
  auth(sessionId: string, t: string | null | undefined): Role | null {
    const m = this.member(sessionId, t);
    return m?.admitted ? m.role : null;
  }

  waiting(sessionId: string): Member[] {
    return (this.db.prepare('SELECT id, role, name, admitted FROM members WHERE session_id = ? AND admitted = 0 ORDER BY created_at').all(sessionId) as Parameters<typeof rowMember>[0][]).map(rowMember);
  }

  /** The host lets someone in. Only one guest at a time. */
  admit(sessionId: string, memberId: string): Member | string {
    this.get(sessionId);
    const r = this.db.prepare('SELECT id, role, name, admitted FROM members WHERE session_id = ? AND id = ?').get(sessionId, memberId) as Parameters<typeof rowMember>[0] | undefined;
    if (!r) return 'They’ve already left';
    if (r.role === 'guest' && this.db.prepare("SELECT 1 FROM members WHERE session_id = ? AND role = 'guest' AND admitted = 1 AND id != ?").get(sessionId, memberId)) return 'A guest is already in the session';
    this.db.prepare('UPDATE members SET admitted = 1 WHERE id = ?').run(memberId);
    return { ...rowMember(r), admitted: true };
  }

  /** The host turns someone away: their token stops working. */
  deny(sessionId: string, memberId: string) {
    this.db.prepare('DELETE FROM members WHERE session_id = ? AND id = ? AND admitted = 0').run(sessionId, memberId);
  }

  /** Remove someone already in (a second guest replacing the first, say). */
  remove(sessionId: string, memberId: string) {
    this.db.prepare("DELETE FROM members WHERE session_id = ? AND id = ? AND role != 'host'").run(sessionId, memberId);
  }

  /** Ended: the codes are gone. Tokens keep working so tracks can still be fetched. */
  end(sessionId: string) {
    this.get(sessionId);
    this.db.prepare('UPDATE live_sessions SET ended = 1, ended_at = ? WHERE id = ?').run(Date.now(), sessionId);
    this.db.prepare('DELETE FROM invites WHERE session_id = ?').run(sessionId);
  }

  private addMember(sessionId: string, t: string, role: Role, name: string, admitted: boolean): Member {
    const id = token().slice(0, 8);
    this.db.prepare('INSERT INTO members (id, session_id, token_hash, role, name, admitted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, sessionId, hash(t), role, name, admitted ? 1 : 0, Date.now());
    return { id, role, name, admitted };
  }

  private get(id: string) {
    const s = this.session(id);
    if (!s) throw new Error('No such session');
    return s;
  }
}

/** Who's connected to a session's live room right now. Only one guest at a time. */
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
