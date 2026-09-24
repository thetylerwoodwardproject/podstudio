/*
 * Voice follow on Chrome's speech recognition (Web Speech API). Chrome sends
 * the audio to Google to transcribe it, so this needs an internet connection.
 *
 * Events:
 *   "word"   detail: index of the script word just spoken (display word index)
 *   "lost"   the reader has gone off script for a while (ad-lib or skipped)
 *   "found"  back on script after "lost"
 *   "heard"  detail: the latest recognized text
 *   "status" detail: 'listening' | 'stopped' | 'error'
 *   "error"  detail: 'not-allowed' | 'network' | 'unsupported' | string
 */

import { locate, normalize } from './match.ts';

interface Recognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

type Ctor = new () => Recognition;
const Ctor = (): Ctor | undefined =>
  (globalThis as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor }).SpeechRecognition ??
  (globalThis as unknown as { webkitSpeechRecognition?: Ctor }).webkitSpeechRecognition;

export const voiceFollowSupported = () => !!Ctor();

/** Words heard off script before voice follow says it has lost the reader. */
const LOST_AFTER_WORDS = 9;
const TAIL = 8;

export class VoiceFollow extends EventTarget {
  /** Normalized script tokens and the display word each came from */
  private tokens: string[] = [];
  private tokenWord: number[] = [];
  private cursor = 0;
  private rec: Recognition | null = null;
  private running = false;
  private heardCount = 0;
  /** Heard words before this index (in the current recognition session) are ignored */
  private baseline = 0;
  private lastText = '';
  private offScript = 0;
  lost = false;
  /** Display index of the last word matched by voice */
  lastMatch = -1;

  readonly lang: string;

  constructor(displayWords: string[], lang = navigator.language || 'en-US') {
    super();
    this.lang = lang;
    displayWords.forEach((w, i) => {
      for (const t of normalize(w)) {
        this.tokens.push(t);
        this.tokenWord.push(i);
      }
    });
  }

  /**
   * Move the expected position after a manual jump (click, arrow keys, retake,
   * producer remote). Words heard before the jump are forgotten, so they can't
   * pull the reader back to where they were.
   */
  setWord(displayIndex: number) {
    if (displayIndex === this.lastMatch) return; // our own match echoed back
    const t = this.tokenWord.findIndex((w) => w >= displayIndex);
    this.cursor = t < 0 ? this.tokens.length - 1 : t;
    this.offScript = 0;
    this.baseline = this.heardCount;
    this.lastMatch = -1;
    if (this.lost) {
      this.lost = false;
      this.emit('found');
    }
  }

  start() {
    const C = Ctor();
    if (!C) {
      this.emit('error', 'unsupported');
      return;
    }
    this.running = true;
    this.listen(C);
  }

  stop() {
    this.running = false;
    this.rec?.abort();
    this.rec = null;
    this.emit('status', 'stopped');
  }

  private listen(C: Ctor) {
    const rec = new C();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.lang;
    this.heardCount = 0;
    this.baseline = 0;
    this.lastText = '';
    rec.onresult = (e) => this.onResult(e);
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.emit('error', e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') this.running = false;
    };
    // Chrome ends a session after silence or about a minute; keep listening.
    rec.onend = () => {
      if (this.running && this.rec === rec) setTimeout(() => this.running && this.listen(C), 150);
      else this.emit('status', 'stopped');
    };
    this.rec = rec;
    rec.start();
    this.emit('status', 'listening');
  }

  private onResult(e: RecognitionEvent) {
    let text = '';
    for (let i = 0; i < e.results.length; i++) text += ' ' + e.results[i][0].transcript;
    // Interim results are revised as Chrome hears more; a changed guess is worth a
    // look even when the word count stays the same.
    if (text === this.lastText) return;
    this.lastText = text;
    const words = normalize(text);
    const fresh = Math.max(0, words.length - this.heardCount);
    this.heardCount = words.length;
    this.emit('heard', text.trim());

    const usable = words.slice(Math.min(this.baseline, words.length));
    if (!usable.length) return;
    const hit = locate(this.tokens, usable.slice(-TAIL), this.cursor, { ahead: this.lost ? 400 : 60, behind: this.lost ? 400 : 12 });
    if (hit) {
      this.cursor = Math.min(hit.index + 1, this.tokens.length - 1);
      this.offScript = 0;
      this.lastMatch = this.tokenWord[hit.index];
      this.emit('word', this.lastMatch);
      if (this.lost) {
        this.lost = false;
        this.emit('found');
      }
    } else {
      this.offScript += fresh;
      if (!this.lost && this.offScript >= LOST_AFTER_WORDS) {
        this.lost = true;
        this.emit('lost');
      }
    }
  }

  private emit(type: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

/** Short, human text for a speech recognition error. */
export function voiceErrorText(err: string): string {
  switch (err) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone blocked';
    case 'audio-capture':
      return 'No microphone found';
    case 'network':
      return 'Voice follow needs internet';
    case 'unsupported':
      return 'Voice follow needs Chrome';
    case 'language-not-supported':
      return 'Language not supported';
    default:
      return `Voice follow stopped (${err})`;
  }
}
