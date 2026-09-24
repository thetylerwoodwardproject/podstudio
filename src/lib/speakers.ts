/*
 * Speaker colors: six presets plus any custom color. Choices are kept in
 * localStorage and applied as --spk-<name> custom properties, so a change in
 * the cast panel shows up on every screen (prompter, transcript, export).
 */

export const presets = [
  { name: 'Yellow', value: 'oklch(83.77% 0.148 81.72)' },
  { name: 'Teal', value: 'oklch(90.16% 0.173 188.71)' },
  { name: 'Green', value: 'oklch(92.06% 0.269 124.67)' },
  { name: 'Red', value: 'oklch(72% 0.221 23.68)' },
  { name: 'Purple', value: 'oklch(72% 0.1 291.04)' },
  { name: 'Black', value: 'oklch(83% 0 0)' },
] as const;

export const defaultColors: Record<string, string> = {
  TYLER: presets[0].value,
  SAM: presets[1].value,
  DANA: presets[4].value,
};

export const STORAGE_KEY = 'podstudio:speaker-colors';

export function loadColors(): Record<string, string> {
  try {
    return { ...defaultColors, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch {
    return { ...defaultColors };
  }
}

export function saveColor(key: string, value: string) {
  const colors = loadColors();
  colors[key] = value;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
  } catch {
    // Private mode or blocked storage: the color still applies to this page.
  }
  applyColor(key, value);
}

export function applyColor(key: string, value: string) {
  document.documentElement.style.setProperty(`--spk-${key.toLowerCase()}`, value);
}

/** WCAG relative luminance of a #rrggbb color. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const f = (x: number) => {
    x /= 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}

/** Below this, a custom color is hard to read on the dark screens. */
export const LOW_CONTRAST = 0.18;

export function presetFor(value: string) {
  return presets.find((p) => p.value === value);
}
