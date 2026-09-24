/*
 * User settings kept in the browser until the server stores them. The studio
 * screen, the settings pages and the prompters all read from here.
 */

import type { BitDepth, Channels } from './audio/wav';

export interface RecordingSettings {
  depth: BitDepth;
  /** kHz, as shown in the UI */
  rate: 44.1 | 48;
  /** 1 mono, 2 stereo (inputs 1 and 2 as left and right) */
  channels: Channels;
  tone: boolean;
  micCheck: boolean;
  download: 'separate' | 'combined';
  deviceId: string;
  recorder: string;
  /** One continuous file with retake and pause markers (8a, the default), or separate takes */
  mode: 'takes' | 'continuous';
  /** Beep when a retake is marked in continuous mode */
  retakeTone: boolean;
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
  recording: { depth: 24, rate: 48, channels: 1, tone: false, micCheck: true, download: 'separate', deviceId: '', recorder: 'mac', mode: 'continuous', retakeTone: true },
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
    // v2: Continuous became the default recording mode.
    if ((saved.version ?? 1) < 2 && saved.recording) delete (saved.recording as Partial<RecordingSettings>).mode;
    return {
      recording: { ...defaults.recording, ...saved.recording },
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
  } catch {
    // Storage blocked: settings last for this page only.
  }
  return s;
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
