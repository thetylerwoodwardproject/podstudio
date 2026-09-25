/*
 * How an episode is recorded: solo, or with one guest (each recording on their
 * own device, talking over Zoom, Teams or similar), with or without a
 * producer, and what the script is. Kept per episode in this browser until
 * the server stores it.
 */
import type { ScriptMode } from './room';

export interface ShowSetup {
  format: 'solo' | 'guest';
  mode: ScriptMode;
  producer: boolean;
  hostName: string;
  /** Talking points mode: the bullets */
  points: string[];
}

export const GUEST = 'GUEST';

export const modeInfo: Record<ScriptMode, { label: string; short: string; guestSees: string }> = {
  lines: {
    label: 'Speaker lines',
    short: 'HOST: and GUEST: lines. Each screen highlights its own lines.',
    guestSees: 'The script, with their lines highlighted',
  },
  host: {
    label: 'Host script, guest free',
    short: 'The script is yours. The guest just talks.',
    guestSees: 'A recording light and their level, no script',
  },
  points: {
    label: 'Talking points',
    short: 'Bullets instead of a word-for-word script.',
    guestSees: 'The talking points, with the current one highlighted',
  },
  adlib: {
    label: 'Ad-lib',
    short: 'No script at all.',
    guestSees: 'A recording light and their level',
  },
};

const defaults = (hostName: string): ShowSetup => ({ format: 'solo', mode: 'host', producer: false, hostName, points: [] });
const key = (episodeId: string) => `podstudio:show:${episodeId}`;

export function loadShow(episodeId: string, hostName = 'Tyler'): ShowSetup {
  try {
    return { ...defaults(hostName), ...JSON.parse(localStorage.getItem(key(episodeId)) || '{}') };
  } catch {
    return defaults(hostName);
  }
}

export function saveShow(episodeId: string, patch: Partial<ShowSetup>): ShowSetup {
  const next = { ...loadShow(episodeId), ...patch };
  try {
    localStorage.setItem(key(episodeId), JSON.stringify(next));
  } catch {}
  import('./sync').then((s) => s.pushShow(episodeId));
  return next;
}

/** Whose line it is, in speaker-lines mode: the guest's lines are marked GUEST (or the guest's name). */
export const isGuestLine = (who: string, guestName = '') => who === GUEST || (!!guestName && who === guestName.toUpperCase());

/** "123456" → "123 456" */
export const formatCode = (code: string | null) => (code ? `${code.slice(0, 3)} ${code.slice(3)}` : '—');
