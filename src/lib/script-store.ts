/*
 * The episode script used by every live screen: the user's own (pasted,
 * imported or edited, kept in this browser until the server exists) or the
 * example episode. Stored as import-format text ("NAME:" lines, "## Heading"
 * sections) so it round-trips through the editor.
 */

import { defaultScriptText } from '@/data/script';
import { parseScript, type ParsedLine } from './script-parser';

export interface EpisodeScript {
  text: string;
  custom: boolean;
  lines: ParsedLine[];
  sections: { title: string; line: number }[];
  /** Every word, in order; prompters and voice follow use these indexes */
  words: string[];
  /** Index in words of the first word of each line */
  lineStarts: number[];
  speakers: string[];
}

const key = (episodeId: string) => `podstudio:script:${episodeId}`;
const split = (text: string) => text.split(/\s+/).filter(Boolean);

export function scriptFromText(text: string, custom = false): EpisodeScript {
  const parsed = parseScript(text);
  const lines = parsed.lines;
  const words: string[] = [];
  const lineStarts: number[] = [];
  for (const l of lines) {
    lineStarts.push(words.length);
    words.push(...split(l.text));
  }
  const sections = parsed.sections
    .map((title) => ({ title, line: lines.findIndex((l) => l.section === title) }))
    .filter((s) => s.line >= 0);
  return { text, custom, lines, sections, words, lineStarts, speakers: [...parsed.speakers.keys()] };
}

export function loadScript(episodeId: string): EpisodeScript {
  try {
    const saved = localStorage.getItem(key(episodeId));
    if (saved && parseScript(saved).lines.length) return scriptFromText(saved, true);
  } catch {
    // Storage blocked: use the example.
  }
  return scriptFromText(defaultScriptText);
}

export function saveScriptText(episodeId: string, text: string) {
  try {
    localStorage.setItem(key(episodeId), text);
  } catch {
    // Storage blocked: the change lasts for this page only.
  }
}

export function resetScript(episodeId: string) {
  try {
    localStorage.removeItem(key(episodeId));
  } catch {}
}

/** Script lines back to import-format text. */
export function scriptToText(lines: ParsedLine[]) {
  let section: string | null = null;
  let prev = '';
  const out: string[] = [];
  for (const l of lines) {
    if (l.section && l.section !== section) {
      if (out.length) out.push('');
      out.push(`## ${l.section}`);
      section = l.section;
    }
    // An unnamed line keeps the last speaker when read back, so say HOST again after a guest's.
    for (const c of l.cues ?? []) out.push(`[pad ${c.key}${c.note ? ` · ${c.note}` : ''}]`);
    const who = l.who || (prev ? 'HOST' : '');
    out.push(who ? `${who}: ${l.text}` : l.text);
    prev = l.who;
  }
  return out.join('\n') + '\n';
}

