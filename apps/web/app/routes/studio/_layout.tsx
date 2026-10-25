import { redirect, type MiddlewareFunction } from "react-router";
import { auth } from "~/lib/auth.server";
import { StudioShell } from "~/components/layout/studio-shell";
import { getBrandTheme } from "~/lib/brand.server";
import { getShellShow } from "~/lib/shell.server";
import { getCurrentUserRole } from "~/lib/authz.server";
import { accentHex, onAccent, studioAccent } from "~/lib/brand-theme";

// The actual gate. This is MIDDLEWARE, not just a loader, on purpose: a parent
// layout's loader guards page loads but does NOT stop a child route's *action*
// from running — an unauthenticated POST to e.g. /studio/podroll executed (and
// wrote to the DB) and was only redirected afterwards. Middleware runs before
// every loader and action under /studio, so no session means nothing runs.
// (See CHANGELOG 2026-10-23, "unauthenticated writes".) The loader below keeps
// its own check as defense in depth and to get the user for the shell.
export const middleware: MiddlewareFunction[] = [
  async ({ request }) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw redirect("/login");
  },
];

export async function loader({ request }: { request: Request }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return redirect("/login");
  // Brand & theme (29b) "Studio" scope: primary buttons, focus ring and the
  // active-nav bar take the show's accent — ink becomes bone and low-contrast
  // accents are lightened (studioAccent). Off by default; null when off.
  const theme = getBrandTheme();
  let brand: { accent: string; onAccent: string } | null = null;
  if (theme?.scopes.studio) {
    const accent = studioAccent(accentHex(theme));
    brand = { accent, onAccent: onAccent(accent) };
  }
  return { user: session.user, brand, show: getShellShow(), role: await getCurrentUserRole(request) };
}

export default function StudioLayout({
  loaderData,
}: {
  loaderData: {
    user: { name: string; email: string };
    brand: { accent: string; onAccent: string } | null;
    show: { title: string; episodes: number; artworkUrl: string | null } | null;
    role: "admin" | "editor" | null;
  };
}) {
  const { user, brand, show, role } = loaderData;
  if (!brand) return <StudioShell user={user} show={show} role={role} />;
  // `display: contents` keeps the shell's grid layout while letting the CSS
  // variables inherit to everything inside.
  return (
    <div
      data-studio-brand
      style={
        {
          display: "contents",
          "--primary": brand.accent,
          "--primary-foreground": brand.onAccent,
          "--ring": brand.accent,
          "--studio-nav-bar": brand.accent,
        } as React.CSSProperties
      }
    >
      <StudioShell user={user} show={show} role={role} />
    </div>
  );
}
