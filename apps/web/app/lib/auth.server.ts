import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@podstudio/db";
import * as schema from "@podstudio/db";

// Deliberate shortcut, not the full BUILD_PLAN §2 auth scope: email verification,
// password reset, and invite redemption all need email delivery, which is still an
// open "Outstanding input" in docs/design/STATUS.md. This is single seeded-admin
// email/password only — flip requireEmailVerification once that's chosen.
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
    // Plural table names (`users`, `sessions`, ...) to match BUILD_PLAN §4's own
    // naming convention (shows/episodes/people are all plural) instead of Better
    // Auth's singular default. This table replaces the earlier hand-rolled `users`
    // table in packages/db/src/schema.ts — one identity table, not two.
    usePlural: true,
  }),
  secret: requireEnv("BETTER_AUTH_SECRET"),
  baseURL: process.env.BETTER_AUTH_URL, // unset in local dev: derived from the request
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "editor",
        input: false, // set server-side only (seed script), not by the sign-up form
      },
    },
  },
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Generate one with: openssl rand -hex 32`,
    );
  }
  return value;
}
