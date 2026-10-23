// Pure helpers for episode forms (no DB), unit-tested in episode-fields.test.ts.
export function slugify(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "episode";
}

/** Parse an optional non-negative integer form field: "" -> null, junk -> undefined. */
export function parseOptionalInt(raw: string): number | null | undefined {
  const v = raw.trim();
  if (v === "") return null;
  return /^\d{1,6}$/.test(v) ? Number(v) : undefined;
}
