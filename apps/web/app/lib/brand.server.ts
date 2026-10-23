import { eq } from "drizzle-orm";
import { db, shows } from "@podstudio/db";
import { readBrandTheme, normalizeHex, type BrandTheme } from "~/lib/brand-theme";

// Server-only — see CHANGELOG, "Real bug: two sidebar links silently failed
// to navigate." The theme is the existing `shows.theme` JSON column
// (BUILD_PLAN §4), so no migration.
export function getBrandTheme() {
  const show = db.select({ theme: shows.theme }).from(shows).get();
  return show ? readBrandTheme(show.theme) : null;
}

export function saveBrandTheme(
  input: Partial<Record<keyof BrandTheme, unknown>> & { customHex?: unknown },
): { ok: true } | { ok: false; error: string } {
  const show = db.select({ id: shows.id }).from(shows).get();
  if (!show) return { ok: false, error: "No show seeded yet." };

  if (input.accent === "custom") {
    if (typeof input.customHex !== "string" || !normalizeHex(input.customHex)) {
      return { ok: false, error: "Enter a valid hex colour, like #c47f12." };
    }
  }
  // readBrandTheme re-validates every field against its allow-list.
  const theme = readBrandTheme(input);
  db.update(shows).set({ theme }).where(eq(shows.id, show.id)).run();
  return { ok: true };
}
