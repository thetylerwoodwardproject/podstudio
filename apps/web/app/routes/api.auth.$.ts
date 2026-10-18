import type { Route } from "./+types/api.auth.$";
import { auth } from "~/lib/auth.server";

// Mounts Better Auth's own fetch handler at /api/auth/* (its default basePath).
// No app logic belongs here — sign-in/sign-up/session endpoints are all Better
// Auth's, called through app/lib/auth-client.ts.
export async function loader({ request }: Route.LoaderArgs) {
  return auth.handler(request);
}

export async function action({ request }: Route.ActionArgs) {
  return auth.handler(request);
}
