/*
 * The episode script used by every live screen: the user's own (pasted,
 * imported or edited, kept in this browser until the server exists) or the
 * example episode. Stored as import-format text ("NAME:" lines, "## Heading"
 * sections) so it round-trips through the editor.
 */

import { defaultScriptText } from '@/data/script';
import { parseScript } from './script-parser';
import { presets } from './speakers';

export interface EpisodeScript {
  text: string;
  custom: boolean;
  lines: { who: string; text: string; section: string | null }[];
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
export function scriptToText(lines: { who: string; text: string; section: string | null }[]) {
  let section: string | null = null;
  const out: string[] = [];
  for (const l of lines) {
    if (l.section && l.section !== section) {
      if (out.length) out.push('');
      out.push(`## ${l.section}`);
      section = l.section;
    }
    out.push(l.who ? `${l.who}: ${l.text}` : l.text);
  }
  return out.join('\n') + '\n';
}

const KNOWN = new Set(['TYLER', 'SAM', 'DANA']);

/** Color for a speaker: the cast colors for the known cast, a preset for anyone else. */
export function speakerColor(who: string) {
  if (!who) return 'var(--spk-unknown)';
  if (KNOWN.has(who)) return `var(--spk-${who.toLowerCase()})`;
  let h = 0;
  for (const c of who) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const spare = presets.filter((_, i) => ![0, 1, 4].includes(i));
  return spare[h % spare.length].value;
}

export const speakerName = (who: string) => (who ? who.charAt(0) + who.slice(1).toLowerCase() : '—');
