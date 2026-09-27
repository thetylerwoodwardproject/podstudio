/*
 * The sections of an imported script, for the import dialog's Sections step:
 * grouped from the parsed lines, renamed and reordered there, then written
 * back as lines (and to text with scriptToText). Lines before the first
 * heading stay first.
 */
import type { ParsedLine } from './script-parser.ts';

export interface Section {
  name: string;
  lines: ParsedLine[];
}

export function groupSections(lines: ParsedLine[]): { intro: ParsedLine[]; sections: Section[] } {
  const intro: ParsedLine[] = [];
  const sections: Section[] = [];
  let last: string | null = null;
  for (const l of lines) {
    if (l.section == null) {
      intro.push(l);
      continue;
    }
    if (l.section !== last || !sections.length) sections.push({ name: l.section, lines: [] });
    sections.at(-1)!.lines.push(l);
    last = l.section;
  }
  return { intro, sections };
}

/** Back to lines, each carrying its section's (new) name. */
export const flattenSections = (intro: ParsedLine[], sections: Section[]): ParsedLine[] => [
  ...intro,
  ...sections.flatMap((s) => s.lines.map((l) => ({ ...l, section: s.name }))),
];

/** Seconds to read these lines at `wpm` words a minute. */
export const readSeconds = (lines: ParsedLine[], wpm: number) => (lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0) / Math.max(1, wpm)) * 60;

/** "~5:10" */
export const readTime = (seconds: number) => {
  const s = Math.round(seconds);
  return `~${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** A copy with the item at `from` moved to `to`. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const out = items.slice();
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, x);
  return out;
}
