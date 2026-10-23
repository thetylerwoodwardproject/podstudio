import { eq } from "drizzle-orm";
import { db, users } from "@podstudio/db";
import { auth } from "~/lib/auth.server";

// Server-only. The studio layout only checks that a session exists, so any
// route whose actions are role-sensitive must check the role itself. Role is
// read from the DB, not the session payload, so a demotion applies immediately.
export async function getCurrentUserRole(request: Request): Promise<"admin" | "editor" | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  const row = db.select({ role: users.role }).from(users).where(eq(users.id, session.user.id)).get();
  return row?.role === "admin" ? "admin" : row ? "editor" : null;
}

/** Throws a 403 unless the caller is an admin. Call at the top of role-sensitive actions. */
export async function requireAdmin(request: Request) {
  if ((await getCurrentUserRole(request)) !== "admin") {
    throw new Response("Only admins can do this.", { status: 403 });
  }
}
