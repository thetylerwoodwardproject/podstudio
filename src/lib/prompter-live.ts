/*
 * Drives a prompter screen (phone prompter, monitor):
 *
 * 1. ?demo → the animated demo from the design.
 * 2. A recorder is live in this browser → follow its word position.
 * 3. Otherwise → this screen's own voice follow, or manual scrolling if the
 *    prompter settings say so.
 *
 * Also handles keyboard shortcuts and producer-remote commands.
 */

import { Prompter, startDemo } from './prompter';
import { Session } from './session';
import { loadSettings, saveSettings } from './settings';
import { VoiceFollow, voiceErrorText } from './voice/follow';

export type LiveStatus =
  | { kind: 'demo' }
  | { kind: 'following'; device: string }
  | { kind: 'voice' }
  | { kind: 'voice-off'; reason: string }
  | { kind: 'manual'; wpm: number; paused: boolean };

export interface LiveOptions {
  episodeId: string;
  words: string[];
  lineStarts: number[];
  onStatus: (s: LiveStatus) => void;
  onFollow: (state: 'read' | 'lost') => void;
  /** Extra keys handled by the page (e.g. M for mirror) */
  onKey?: (e: KeyboardEvent) => void;
}

export function runPrompter(p: Prompter, opts: LiveOptions) {
  const demo = new URL(location.href).searchParams.has('demo');
  if (demo) {
    startDemo(p);
    opts.onStatus({ kind: 'demo' });
    return;
  }

  const session = new Session(opts.episodeId);
  const settings = loadSettings().prompter;
  let voice: VoiceFollow | null = null;
  let following = false;
  let manual: number | undefined;
  let wpm = settings.wpm;
  let paused = false;

  const jump = (i: number) => {
    p.setWord(i);
    voice?.setWord(i);
  };
  const lineOf = (i: number) => opts.lineStarts.reduce((line, start, n) => (i >= start ? n : line), 0);

  const startManual = () => {
    clearInterval(manual);
    manual = window.setInterval(() => !paused && p.index < p.length - 1 && p.setWord(p.index + 1), 60000 / wpm);
    opts.onStatus({ kind: 'manual', wpm, paused });
  };

  const startVoice = () => {
    voice = new VoiceFollow(opts.words);
    voice.engine = settings.voiceEngine;
    voice.setWord(p.index);
    voice.addEventListener('word', (e) => !paused && p.setWord((e as CustomEvent<number>).detail));
    voice.addEventListener('lost', () => opts.onFollow('lost'));
    voice.addEventListener('found', () => opts.onFollow('read'));
    voice.addEventListener('error', (e) => {
      const err = (e as CustomEvent<string>).detail;
      const retryable = err !== 'network' && err !== 'unsupported';
      const reason = voiceErrorText(err) + (retryable ? ' · tap to retry' : '');
      opts.onStatus({ kind: 'voice-off', reason });
    });
    voice.addEventListener('status', (e) => (e as CustomEvent<string>).detail === 'listening' && opts.onStatus({ kind: 'voice' }));
    voice.start();
  };

  /** Called by the page when the user taps the status to retry voice follow. */
  const retry = () => {
    if (following) return;
    voice?.stop();
    startVoice();
  };

  session.findRecorder().then((rec) => {
    if (rec) {
      following = true;
      opts.onStatus({ kind: 'following', device: rec.device });
    } else if (settings.mode === 'manual') {
      startManual();
    } else {
      startVoice();
    }
  });

  // Following a recorder in another tab.
  session.on('word', (m) => following && !paused && p.setWord(m.index));
  session.on('follow', (m) => following && opts.onFollow(m.state));
  session.on('rec', (m) => {
    if (m.recording && !following) {
      voice?.stop();
      voice = null;
      clearInterval(manual);
      manual = undefined;
      following = true;
      opts.onStatus({ kind: 'following', device: m.device });
    } else if (!m.recording && following) {
      // The take ended: this screen goes back to following on its own.
      following = false;
      if (settings.mode === 'manual') startManual();
      else startVoice();
    }
  });

  // Producer remote.
  session.on('control', (m) => {
    if (m.action === 'pause') paused = true;
    if (m.action === 'resume') paused = false;
    if (m.action === 'goto' && m.word != null) jump(m.word);
    if (m.action === 'next') jump(opts.lineStarts[Math.min(lineOf(p.index) + 1, opts.lineStarts.length - 1)]);
    if (m.action === 'prev') jump(opts.lineStarts[Math.max(lineOf(p.index) - 1, 0)]);
    if (manual !== undefined) opts.onStatus({ kind: 'manual', wpm, paused });
  });

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).matches('input, textarea, select, [contenteditable]')) return;
    const line = lineOf(p.index);
    switch (e.key) {
      case ' ':
        e.preventDefault();
        paused = !paused;
        if (manual !== undefined) opts.onStatus({ kind: 'manual', wpm, paused });
        break;
      case 'ArrowRight':
        jump(opts.lineStarts[Math.min(line + 1, opts.lineStarts.length - 1)]);
        break;
      case 'ArrowLeft':
        jump(opts.lineStarts[Math.max(line - 1, 0)]);
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        if (manual === undefined) break;
        e.preventDefault();
        wpm = Math.max(60, Math.min(260, wpm + (e.key === 'ArrowUp' ? 10 : -10)));
        saveSettings('prompter', { wpm });
        startManual();
        break;
      case 'j':
      case 'J':
        if (voice && voice.lastMatch >= 0) jump(voice.lastMatch);
        break;
      case '+':
      case '=':
      case '-': {
        const size = Math.max(18, Math.min(60, loadSettings().prompter.size + (e.key === '-' ? -2 : 2)));
        saveSettings('prompter', { size });
        document.dispatchEvent(new CustomEvent('prompter-settings'));
        break;
      }
      default:
        opts.onKey?.(e);
    }
  });

  return { retry, jump, session };
}
