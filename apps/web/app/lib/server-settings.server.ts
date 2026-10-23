import { eq } from "drizzle-orm";
import { db, users } from "@podstudio/db";
import { auth } from "~/lib/auth.server";

// Server-only, same hard rule as storage.server.ts/feed.server.ts/
// episodes.server.ts: no @podstudio/db or better-auth access in
// server-settings.tsx itself, so none of it can leak into that route's
// client bundle. See CHANGELOG, "Real bug: two sidebar links silently
// failed to navigate."
export function getDomainInfo() {
  return {
    hostname: process.env.BETTER_AUTH_URL ?? "(BETTER_AUTH_URL not set)",
  };
}

export function listUsers() {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(users.createdAt)
    .all();
}

export async function getCurrentUserId(request: Request): Promise<string | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user.id ?? null;
}

// Role comes from the DB, not the (5-minute cookie-cached) session payload, so
// a demotion takes effect immediately.
export async function getCurrentUserRole(request: Request): Promise<"admin" | "editor" | null> {
  const id = await getCurrentUserId(request);
  if (!id) return null;
  const row = db.select({ role: users.role }).from(users).where(eq(users.id, id)).get();
  return row?.role === "admin" ? "admin" : row ? "editor" : null;
}

export const MIN_PASSWORD_LENGTH = 8; // Better Auth's own minimum; stated here so the UI and the check agree

export async function changeOwnPassword(
  request: Request,
  input: { current: string; next: string; confirm: string },
): Promise<{ ok: true; headers: Headers } | { ok: false; error: string }> {
  if (!input.current) return { ok: false, error: "Enter your current password." };
  if (input.next.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (input.next !== input.confirm) return { ok: false, error: "The new passwords don't match." };
  if (input.next === input.current) return { ok: false, error: "The new password must differ from the current one." };
  try {
    // revokeOtherSessions signs out every other device — the right default
    // after a password change (e.g. a lost laptop).
    // With revokeOtherSessions Better Auth issues a NEW session for this device;
    // its Set-Cookie has to reach the browser (returnHeaders) or this user is
    // signed out by their own password change.
    const { headers } = await auth.api.changePassword({
      body: { currentPassword: input.current, newPassword: input.next, revokeOtherSessions: true },
      headers: request.headers,
      returnHeaders: true,
    });
    return { ok: true, headers };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: /invalid password/i.test(message) ? "Your current password is wrong." : message };
  }
}

function adminCount(excludingId?: string) {
  return db
    .select()
    .from(users)
    .where(eq(users.role, "admin"))
    .all()
    .filter((u) => u.id !== excludingId).length;
}

export async function addUser(input: {
  name: string;
  email: string;
  password: string;
  role: "admin" | "editor";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const result = await auth.api.signUpEmail({
      body: { email: input.email, password: input.password, name: input.name },
    });
    // additionalFields.role has input: false (the public sign-up API won't accept
    // it), so set it directly here — same pattern as seed-admin.ts.
    db.update(users).set({ role: input.role }).where(eq(users.id, result.user.id)).run();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export function updateUserRole(
  id: string,
  role: "admin" | "editor",
): { ok: true } | { ok: false; error: string } {
  if (role !== "admin" && adminCount(id) === 0) {
    return { ok: false, error: "Can't demote the only remaining admin." };
  }
  db.update(users).set({ role }).where(eq(users.id, id)).run();
  return { ok: true };
}

export function removeUser(
  id: string,
  currentUserId: string | null,
): { ok: true } | { ok: false; error: string } {
  if (id === currentUserId) {
    return { ok: false, error: "You can't remove your own account." };
  }
  if (adminCount(id) === 0) {
    return { ok: false, error: "Can't remove the only remaining admin." };
  }
  // sessions/accounts cascade via their existing onDelete: "cascade" FK
  // (foreign_keys = ON in packages/db/src/client.ts).
  db.delete(users).where(eq(users.id, id)).run();
  return { ok: true };
}
