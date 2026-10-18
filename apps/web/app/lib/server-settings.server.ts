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
