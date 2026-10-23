import { describe, expect, it } from "vitest";
import {
  BRAND_PRESETS,
  DEFAULT_BRAND_THEME,
  contrast,
  linkColor,
  normalizeHex,
  onAccent,
  readBrandTheme,
  studioAccent,
  BONE,
} from "./brand-theme";

describe("normalizeHex", () => {
  it("accepts #rgb, rgb, #rrggbb and lowercases", () => {
    expect(normalizeHex("#FA0")).toBe("#ffaa00");
    expect(normalizeHex("fa0")).toBe("#ffaa00");
    expect(normalizeHex(" #C47F12 ")).toBe("#c47f12");
  });
  it("rejects junk", () => {
    for (const bad of ["", "zzz", "#12", "#12345", "#1234567", "red", "#ggg"]) expect(normalizeHex(bad)).toBeNull();
  });
});

describe("contrast", () => {
  it("is 21:1 for black on white and symmetric", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
  });
  it("is 1:1 for identical colours", () => {
    expect(contrast("#e8b04a", "#e8b04a")).toBeCloseTo(1, 5);
  });
});

describe("onAccent", () => {
  it("picks whichever of #111113 / #fff has more contrast, for every preset", () => {
    for (const p of Object.values(BRAND_PRESETS)) {
      const chosen = onAccent(p.hex);
      const other = chosen === "#111113" ? "#ffffff" : "#111113";
      expect(contrast(p.hex, chosen)).toBeGreaterThanOrEqual(contrast(p.hex, other));
    }
  });
  it("amber gets dark text, ink gets white", () => {
    expect(onAccent(BRAND_PRESETS.amber.hex)).toBe("#111113");
    expect(onAccent(BRAND_PRESETS.ink.hex)).toBe("#ffffff");
  });
});

describe("linkColor", () => {
  it("reaches 4.5:1 on the page background for every preset, light and dark", () => {
    for (const p of Object.values(BRAND_PRESETS)) {
      expect(contrast(linkColor(p.hex, "light"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(linkColor(p.hex, "dark"), "#151517")).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("leaves an already-passing colour untouched", () => {
    expect(linkColor("#1b1a18", "light")).toBe("#1b1a18");
  });
  it("darkens in light mode and lightens in dark mode", () => {
    const amber = BRAND_PRESETS.amber.hex;
    expect(linkColor(amber, "light")).not.toBe(amber);
    expect(linkColor("#1b1a18", "dark")).not.toBe("#1b1a18");
  });
});

describe("studioAccent", () => {
  it("turns ink into bone", () => {
    expect(studioAccent("#1b1a18")).toBe(BONE);
  });
  it("lightens an accent under 3:1 on #111113 and leaves a passing one alone", () => {
    expect(contrast(studioAccent("#2a2a60"), "#111113")).toBeGreaterThanOrEqual(3);
    expect(studioAccent(BRAND_PRESETS.amber.hex)).toBe(BRAND_PRESETS.amber.hex);
  });
});

describe("readBrandTheme", () => {
  it("returns defaults for null/garbage", () => {
    expect(readBrandTheme(null)).toEqual(DEFAULT_BRAND_THEME);
    expect(readBrandTheme("nope")).toEqual(DEFAULT_BRAND_THEME);
  });
  it("falls back from a custom accent that has no valid hex", () => {
    expect(readBrandTheme({ accent: "custom", customHex: "nope" }).accent).toBe(DEFAULT_BRAND_THEME.accent);
  });
  it("rejects unknown enum values field by field and keeps good ones", () => {
    const t = readBrandTheme({ accent: "teal", appearance: "neon", corners: "round", scopes: { studio: true, embeds: "yes" } });
    expect(t.accent).toBe("teal");
    expect(t.appearance).toBe(DEFAULT_BRAND_THEME.appearance);
    expect(t.corners).toBe("round");
    expect(t.scopes.studio).toBe(true);
    expect(t.scopes.embeds).toBe(DEFAULT_BRAND_THEME.scopes.embeds);
  });
  it("normalizes a custom hex", () => {
    expect(readBrandTheme({ accent: "custom", customHex: "#FA0" })).toMatchObject({ accent: "custom", customHex: "#ffaa00" });
  });
});
