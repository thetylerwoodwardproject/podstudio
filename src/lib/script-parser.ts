/*
 * Script import rules from the design: a line starting with "NAME:" switches
 * speaker, a "## Heading" line starts a section. Lines without a name keep
 * the current speaker.
 */

export interface ParsedLine {
  who: string;
  text: string;
  section: string | null;
}

export interface ParsedScript {
  lines: ParsedLine[];
  sections: string[];
  /** Speaker name → number of lines, in order of first appearance */
  speakers: Map<string, number>;
  words: number;
}

const SPEAKER = /^([A-Z][A-Z0-9 .'-]{0,23}):\s*(.*)$/;
const HEADING = /^#{1,3}\s+(.+)$/;

export function parseScript(text: string): ParsedScript {
  const lines: ParsedLine[] = [];
  const sections: string[] = [];
  const speakers = new Map<string, number>();
  let who = '';
  let section: string | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = HEADING.exec(line);
    if (heading) {
      section = heading[1].trim();
      sections.push(section);
      continue;
    }
    const named = SPEAKER.exec(line);
    if (named) who = named[1].trim().toUpperCase();
    const body = named ? named[2] : line;
    if (!body) continue;
    lines.push({ who, text: body, section });
    if (who) speakers.set(who, (speakers.get(who) ?? 0) + 1);
  }

  const words = lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
  return { lines, sections, speakers, words };
}
