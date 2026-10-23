import { redirect } from "react-router";
import { auth } from "~/lib/auth.server";
import { StudioShell } from "~/components/layout/studio-shell";
import { getBrandTheme } from "~/lib/brand.server";
import { accentHex, onAccent, studioAccent } from "~/lib/brand-theme";

// The actual gate: every /studio/* route sits behind this loader. No session,
// no studio — this is Deliverable 1 of the 2026-10-18 plan (see CHANGELOG).
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
  return { user: session.user, brand };
}

export default function StudioLayout({
  loaderData,
}: {
  loaderData: { user: { name: string; email: string }; brand: { accent: string; onAccent: string } | null };
}) {
  const { user, brand } = loaderData;
  if (!brand) return <StudioShell user={user} />;
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
      <StudioShell user={user} />
    </div>
  );
}
