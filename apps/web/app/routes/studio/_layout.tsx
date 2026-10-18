import { redirect } from "react-router";
import { auth } from "~/lib/auth.server";
import { StudioShell } from "~/components/layout/studio-shell";

// The actual gate: every /studio/* route sits behind this loader. No session,
// no studio — this is Deliverable 1 of the 2026-10-18 plan (see CHANGELOG).
export async function loader({ request }: { request: Request }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return redirect("/login");
  return { user: session.user };
}

export default function StudioLayout({
  loaderData,
}: {
  loaderData: { user: { name: string; email: string } };
}) {
  return <StudioShell user={loaderData.user} />;
}
