import type { Route } from "./+types/api.auth.$";
import { auth } from "~/lib/auth.server";

// Mounts Better Auth's own fetch handler at /api/auth/* (its default basePath).
// No app logic belongs here — sign-in/sign-up/session endpoints are all Better
// Auth's, called through app/lib/auth-client.ts.
export async function loader({ request }: Route.LoaderArgs) {
  return auth.handler(request);
}

export async function action({ request }: Route.ActionArgs) {
  // Public self-registration is OFF. Better Auth enables /sign-up/email
  // whenever email+password is on, so anyone who could reach this host could
  // create an account (role "editor") and sign straight into the studio —
  // confirmed with curl on 2026-10-23. Accounts are created only by an admin
  // (Server settings → Add user) or the seed script, both of which call
  // `auth.api.signUpEmail` in-process and never touch this HTTP route.
  // (`disableSignUp: true` in the config would also block those calls.)
  if (new URL(request.url).pathname.startsWith("/api/auth/sign-up")) {
    return Response.json({ message: "Sign-up is disabled. Ask an admin to add you." }, { status: 403 });
  }
  return auth.handler(request);
}
