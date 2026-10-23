// Pure colour/theme maths for screen 29b (Brand & theme) — no db access, safe
// for both server and client. Implements the README's contrast rules:
// - text on the accent is #111113 or #fff, whichever has more contrast;
// - the link colour is darkened (light mode) / lightened (dark mode) step by
//   step until it reaches 4.5:1 on the page background.
export const BRAND_PRESETS = {
  ink: { label: "Ink", hex: "#1b1a18" },
  amber: { label: "Amber", hex: "#e8b04a" },
  teal: { label: "Teal", hex: "#178a92" },
  violet: { label: "Violet", hex: "#6b4fd0" },
  coral: { label: "Coral", hex: "#d2452a" },
  green: { label: "Green", hex: "#2f8a4c" },
  blue: { label: "Blue", hex: "#2f6fe0" },
  rose: { label: "Rose", hex: "#c2366b" },
} as const;
export type BrandPresetId = keyof typeof BRAND_PRESETS;

export const APPEARANCES = ["light", "dark", "auto"] as const;
export type Appearance = (typeof APPEARANCES)[number];

export const CORNERS = {
  sharp: { label: "Sharp", control: 3, card: 4 },
  soft: { label: "Soft", control: 8, card: 12 },
  round: { label: "Round", control: 20, card: 18 },
} as const;
export type CornersId = keyof typeof CORNERS;

export interface BrandTheme {
  /** Preset id, or "custom" when `customHex` is used. */
  accent: BrandPresetId | "custom";
  customHex: string | null;
  appearance: Appearance;
  corners: CornersId;
  scopes: { publicSite: boolean; embeds: boolean; studio: boolean };
}

export const DEFAULT_BRAND_THEME: BrandTheme = {
  accent: "amber",
  customHex: null,
  appearance: "auto",
  corners: "soft",
  scopes: { publicSite: true, embeds: true, studio: false },
};

const PAPER = "#ffffff";
const PAGE_DARK = "#151517";
const STUDIO_DARK = "#111113";
export const BONE = "#ecebe6";

export function normalizeHex(input: string): string | null {
  const m = input.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h}`;
}

function toRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]) {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function luminance(hex: string) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function mix(a: string, b: string, t: number) {
  const [ar, ag, ab] = toRgb(a);
  const [br, bg, bb] = toRgb(b);
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

export function accentHex(theme: BrandTheme) {
  if (theme.accent === "custom") return theme.customHex ?? BRAND_PRESETS.amber.hex;
  return BRAND_PRESETS[theme.accent].hex;
}

export function onAccent(accent: string) {
  return contrast(accent, "#111113") >= contrast(accent, "#ffffff") ? "#111113" : "#ffffff";
}

/** Step the accent toward black (light bg) or white (dark bg) until it hits 4.5:1. */
export function linkColor(accent: string, mode: "light" | "dark") {
  const bg = mode === "light" ? PAPER : PAGE_DARK;
  const target = mode === "light" ? "#000000" : "#ffffff";
  let color = accent;
  for (let i = 1; i <= 40 && contrast(color, bg) < 4.5; i++) color = mix(accent, target, i / 40);
  return color;
}

export function tint(accent: string, mode: "light" | "dark") {
  return mix(mode === "light" ? PAPER : PAGE_DARK, accent, 0.12);
}

/** Studio: ink becomes bone, and any accent under 3:1 on #111113 is lightened. */
export function studioAccent(accent: string) {
  if (accent.toLowerCase() === BRAND_PRESETS.ink.hex) return BONE;
  let color = accent;
  for (let i = 1; i <= 40 && contrast(color, STUDIO_DARK) < 3; i++) color = mix(accent, "#ffffff", i / 40);
  return color;
}

export function brandVars(theme: BrandTheme, mode: "light" | "dark") {
  const accent = accentHex(theme);
  const c = CORNERS[theme.corners];
  return {
    "--brand-accent": accent,
    "--brand-on-accent": onAccent(accent),
    "--brand-link": linkColor(accent, mode),
    "--brand-tint": tint(accent, mode),
    "--brand-radius-control": `${c.control}px`,
    "--brand-radius-card": `${c.card}px`,
  } as Record<string, string>;
}

export function readBrandTheme(raw: unknown): BrandTheme {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_BRAND_THEME;
  const customHex = typeof r.customHex === "string" ? normalizeHex(r.customHex) : null;
  let accent: BrandTheme["accent"] =
    r.accent === "custom" || (typeof r.accent === "string" && r.accent in BRAND_PRESETS)
      ? (r.accent as BrandTheme["accent"])
      : d.accent;
  if (accent === "custom" && !customHex) accent = d.accent;
  const sc = (r.scopes && typeof r.scopes === "object" ? r.scopes : {}) as Record<string, unknown>;
  return {
    accent,
    customHex,
    appearance: APPEARANCES.includes(r.appearance as Appearance) ? (r.appearance as Appearance) : d.appearance,
    corners: typeof r.corners === "string" && r.corners in CORNERS ? (r.corners as CornersId) : d.corners,
    scopes: {
      publicSite: typeof sc.publicSite === "boolean" ? sc.publicSite : d.scopes.publicSite,
      embeds: typeof sc.embeds === "boolean" ? sc.embeds : d.scopes.embeds,
      studio: typeof sc.studio === "boolean" ? sc.studio : d.scopes.studio,
    },
  };
}
