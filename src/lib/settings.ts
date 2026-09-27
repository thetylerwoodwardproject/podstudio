/*
 * Each person's settings. The studio screen, the settings pages and the
 * prompters all read them from this browser's copy, straight away; the copy is
 * kept on the server (GET/PUT /api/me/settings) so they follow you to any
 * device. Saving sends the change; opening a page takes the server's copy if
 * it's newer (syncSettings, run by every page). A change made offline is
 * marked unsent and goes up on the next page load. The microphone stays per
 * device: another computer's device ID means nothing here.
 */

import type { BitDepth, Channels } from './audio/wav';
import { defaultTones, type ToneSettings } from './audio/tones';
import { cleanTone, type VoiceTone } from './audio/tone';
import { ApiError, api } from './api';
import { beginSave } from './save-status';

export interface RecordingSettings {
  depth: BitDepth;
  /** kHz, as shown in the UI */
  rate: 44.1 | 48;
  /** 1 mono, 2 stereo (inputs 1 and 2 as left and right) */
  channels: Channels;
  micCheck: boolean;
  deviceId: string;
  /** Beep when a retake is marked */
  retakeTone: boolean;
  /** Noise suppression fader for exports, 0–100 % (0 = off) */
  noiseSuppression: number;
  /** Marker tones mixed into exported recordings, ducked under the voice */
  tones: ToneSettings;
  /** The ready-to-publish episode in exports (lib/audio/master.ts) */
  publish: PublishSettings;
  /** The kinds of file to export (lib/export-files.ts), saved from the picker; null for everything */
  exportFiles: string[] | null;
}

export interface PublishSettings {
  /** −16 LUFS stereo, −19 LUFS mono, or no loudness change (peak limit only) */
  loudness: 'stereo' | 'mono' | 'off';
  /** Level each speaker before the mix (and export levelled copies of each edit) */
  level: boolean;
  /** Show the loudness meter for the episode on the export page */
  meter: boolean;
  /** Each person's tone (EQ and compressor), remembered by speaker name (upper case, as on their track) */
  voices: Record<string, VoiceTone>;
}

export interface PrompterSettings {
  mode: 'voice' | 'manual';
  /** Words per minute for manual mode */
  wpm: number;
  font: string;
  /** Text size in pt (34 pt renders as 58 px on the monitor) */
  size: number;
  spacing: number;
  /** Reading line, percent from the top */
  line: number;
  theme: 'dark' | 'contrast' | 'light' | 'amber';
  mirror: boolean;
  /** Speech engine for voice follow: on-device when installed, else Google's service */
  voiceEngine: 'auto' | 'local' | 'cloud';
}

export interface Settings {
  recording: RecordingSettings;
  prompter: PrompterSettings;
}

export const defaults: Settings = {
  recording: { depth: 24, rate: 48, channels: 1, micCheck: true, deviceId: '', retakeTone: true, noiseSuppression: 0, tones: defaultTones, publish: { loudness: 'stereo', level: false, meter: true, voices: {} }, exportFiles: null },
  prompter: {
    mode: 'voice',
    wpm: 150,
    font: 'var(--font-sans)',
    size: 34,
    spacing: 1.4,
    line: 34,
    theme: 'dark',
    mirror: true,
    voiceEngine: 'auto',
  },
};

const KEY = 'podstudio:settings';

/** Bumped when a default changes and old saved values should give way to it. */
const VERSION = 2;

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Settings> & { version?: number };
    // Settings from when separate takes existed.
    if (saved.recording) for (const old of ['mode', 'tone', 'download']) delete (saved.recording as unknown as Record<string, unknown>)[old];
    // The episode file and MP3 switches, before the export picker replaced them
    if (saved.recording?.publish) for (const old of ['mix', 'mp3']) delete (saved.recording.publish as unknown as Record<string, unknown>)[old];
    const files = saved.recording?.exportFiles;
    return {
      recording: {
        ...defaults.recording,
        ...saved.recording,
        tones: {
          ...defaults.recording.tones,
          ...saved.recording?.tones,
          kinds: { ...defaults.recording.tones.kinds, ...saved.recording?.tones?.kinds },
        },
        publish: {
          ...defaults.recording.publish,
          ...saved.recording?.publish,
          voices: Object.fromEntries(Object.entries(saved.recording?.publish?.voices ?? {}).map(([k, v]) => [k, cleanTone(v)])),
        },
        exportFiles: Array.isArray(files) ? files.filter((k) => typeof k === 'string') : null,
      },
      prompter: { ...defaults.prompter, ...saved.prompter },
    };
  } catch {
    return structuredClone(defaults);
  }
}

export function saveSettings<K extends keyof Settings>(group: K, patch: Partial<Settings[K]>): Settings {
  const s = loadSettings();
  s[group] = { ...s[group], ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, version: VERSION }));
    localStorage.setItem(DIRTY, '1');
  } catch {
    // Storage blocked: settings last for this page only.
  }
  // Before this page has heard from the server, a save is held and made again on the
  // server's copy, so a new device's defaults never overwrite what's there.
  if (!synced) early.push(() => saveSettings(group, patch));
  else {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushSettings, 400);
  }
  return s;
}

// ── On the server ──
/** Set while this browser has a change the server hasn't got */
const DIRTY = `${KEY}:dirty`;
/** When the server's copy that this browser has was saved (its clock) */
const AT = `${KEY}:at`;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let synced = false;
let early: (() => void)[] = [];
const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {}
  },
};

/** What goes to the server: everything but what belongs to this device. */
export function portable(s: Settings) {
  const { deviceId: _device, ...recording } = s.recording;
  return { recording, prompter: s.prompter, version: VERSION };
}

async function pushSettings() {
  const finish = beginSave();
  try {
    const r = await api<{ updatedAt: number }>('me/settings', { method: 'PUT', body: { settings: portable(loadSettings()) } });
    ls.set(AT, String(r.updatedAt));
    ls.set(DIRTY, null);
    finish('saved');
  } catch (err) {
    // Not signed in (a guest's page): the settings stay in this browser only.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      ls.set(DIRTY, null);
      finish('error');
    } else finish('waiting');
  }
}

/**
 * Bring this browser's copy and the server's together: send a change that
 * hasn't gone up yet, or take the server's copy if it's newer. Fires
 * `podstudio:settings` on window when the settings here changed.
 */
export async function syncSettings() {
  try {
    await pull();
  } finally {
    synced = true;
    const held = early;
    early = [];
    held.forEach((again) => again());
  }
}

async function pull() {
  // A change from an earlier page that didn't reach the server: this browser's copy goes up.
  if (ls.get(DIRTY) && !early.length) return pushSettings();
  let r: { settings: Partial<Settings> | null; updatedAt: number };
  try {
    r = await api('me/settings');
  } catch {
    return; // Offline, or not signed in
  }
  // Nothing on the server yet: this browser's settings become the first copy.
  if (!r.settings) return ls.get(KEY) ? pushSettings() : undefined;
  if (r.updatedAt <= Number(ls.get(AT) ?? 0)) return;
  const deviceId = loadSettings().recording.deviceId;
  const server = r.settings as Settings;
  ls.set(KEY, JSON.stringify({ ...server, recording: { ...server.recording, deviceId }, version: VERSION }));
  ls.set(AT, String(r.updatedAt));
  ls.set(DIRTY, null);
  window.dispatchEvent(new Event('podstudio:settings'));
}

/** Sample rate in Hz for a UI rate. */
export const hz = (rate: RecordingSettings['rate']) => (rate === 44.1 ? 44100 : 48000);

/**
 * Prompter colors per theme. now: current word; fg: rest of the current line;
 * soft: upcoming lines for this screen's speaker; dim: other upcoming lines;
 * nowPast: words already said on the current line; past: finished lines;
 * monPast: already-said words on the monitor.
 */
export const themes: Record<
  PrompterSettings['theme'],
  { bg: string; now: string; fg: string; soft: string; dim: string; nowPast: string; past: string; monPast: string }
> = {
  dark: { bg: '#000000', now: '#FFFFFF', fg: '#EDEDEA', soft: '#C9CBCF', dim: '#6A6C71', nowPast: '#5A5C61', past: '#3A3B3F', monPast: '#4A4C51' },
  contrast: { bg: '#000000', now: '#FFFF00', fg: '#FFFF00', soft: '#E6E600', dim: '#8A8A00', nowPast: '#6E6E00', past: '#3D3D00', monPast: '#5A5A00' },
  light: { bg: '#F4F3EF', now: '#000000', fg: '#111111', soft: '#2A2A28', dim: '#8E8C85', nowPast: '#A09E97', past: '#C9C7BF', monPast: '#B5B3AC' },
  amber: { bg: '#000000', now: '#FFC23D', fg: '#FFB000', soft: '#E6A000', dim: '#8A6200', nowPast: '#6E4C00', past: '#3B2900', monPast: '#553B00' },
};

/** Apply prompter settings to a prompter root as CSS custom properties. */
export function applyPrompterLook(el: HTMLElement, p: PrompterSettings) {
  const t = themes[p.theme];
  for (const [k, v] of Object.entries(t)) el.style.setProperty(`--p-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`, v);
  el.style.setProperty('--p-font', p.font);
  el.style.setProperty('--p-scale', String(p.size / 34));
  el.style.setProperty('--p-lh', String(p.spacing));
}
