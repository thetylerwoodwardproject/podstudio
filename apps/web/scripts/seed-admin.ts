// Seeds the single admin account through Better Auth's own API (it owns password
// hashing — never insert into `users`/`accounts` directly). Idempotent: skips if
// that email already exists. Requires PODSTUDIO_ADMIN_PASSWORD (no default, no
// hardcoded secret) plus BETTER_AUTH_SECRET and PODSTUDIO_DB_PATH.
import { auth } from "../app/lib/auth.server";
import { db, users } from "@podstudio/db";
import { eq } from "drizzle-orm";

const ADMIN_EMAIL = "tyler@fullymodulated.com";
const ADMIN_NAME = "Tyler Woodward";

async function main() {
  const password = process.env.PODSTUDIO_ADMIN_PASSWORD;
  if (!password) {
    throw new Error(
      "PODSTUDIO_ADMIN_PASSWORD is not set — refusing to seed an admin with no password.",
    );
  }

  const existing = db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).get();
  if (existing) {
    console.log(`[seed-admin] ${ADMIN_EMAIL} already exists, skipping`);
    return;
  }

  const result = await auth.api.signUpEmail({
    body: { email: ADMIN_EMAIL, password, name: ADMIN_NAME },
  });

  // additionalFields.role has input: false (the sign-up API won't accept it from a
  // client), so set it directly here — this is server-side seeding, not the public
  // sign-up boundary.
  db.update(users).set({ role: "admin" }).where(eq(users.id, result.user.id)).run();

  console.log(`[seed-admin] created admin ${ADMIN_EMAIL} (${result.user.id})`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed-admin] failed:", err);
    process.exit(1);
  });
