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
  onaudiostart?: (() => void) | null;
  onsoundstart?: (() => void) | null;
  onspeechstart?: (() => void) | null;
  /** Chrome 139+: recognize on this device instead of Google's servers */
  processLocally?: boolean;
  options?: { langs: string[]; processLocally: boolean };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

type LocalStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable';
type Ctor = (new () => Recognition) & {
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<LocalStatus>;
  install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
};
const Ctor = (): Ctor | undefined =>
  (globalThis as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor }).SpeechRecognition ??
  (globalThis as unknown as { webkitSpeechRecognition?: Ctor }).webkitSpeechRecognition;

export const voiceFollowSupported = () => !!Ctor();

/** Which speech engine voice follow uses: on this device when possible, or Google's service. */
export type Engine = 'auto' | 'local' | 'cloud';

/**
 * Whether on-device recognition (Chrome 139+) is ready for a language:
 * 'available', 'downloadable', 'downloading', 'unavailable', or 'unsupported'
 * when the browser has no on-device option at all.
 */
export async function localSpeechStatus(lang = navigator.language || 'en-US'): Promise<LocalStatus | 'unsupported'> {
  const C = Ctor();
  if (!C?.available) return 'unsupported';
  try {
    return await C.available({ langs: [lang], processLocally: true });
  } catch {
    return 'unsupported';
  }
}

/** Download the on-device language pack. Call from a click. */
export async function installLocalSpeech(lang = navigator.language || 'en-US'): Promise<boolean> {
  const C = Ctor();
  if (!C?.install) return false;
  try {
    return await C.install({ langs: [lang], processLocally: true });
  } catch {
    return false;
  }
}

/** Best guess at the browser, for troubleshooting messages. */
export function browserName(): string {
  const nav = navigator as Navigator & { brave?: unknown; userAgentData?: { brands: { brand: string }[] } };
  if (nav.brave) return 'Brave';
  const brands = nav.userAgentData?.brands.map((b) => b.brand) ?? [];
  const named = brands.find((b) => !/Chromium|Not.?A.?Brand/i.test(b));
  if (named) return named;
  if (/Edg\//.test(navigator.userAgent)) return 'Microsoft Edge';
  if (brands.includes('Chromium')) return 'Chromium-based browser';
  return 'This browser';
}

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
  /** Set before start(). */
  engine: Engine = 'auto';
  /** True once start() picked on-device recognition */
  local = false;
  private resultsThisSession = false;
  private networkFailures = 0;
  private announced = false;
  private silenceTimer: ReturnType<typeof setTimeout> | undefined;
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

  async start() {
    const C = Ctor();
    if (!C) {
      this.emit('error', 'unsupported');
      return;
    }
    this.running = true;
    if (this.engine !== 'cloud') {
      const status = await localSpeechStatus(this.lang);
      this.local = status === 'available';
      if (this.engine === 'local' && !this.local) {
        this.emit('error', status === 'unsupported' ? 'local-unsupported' : 'local-not-installed');
        this.running = false;
        return;
      }
    }
    this.emit('engine', this.local ? 'local' : 'cloud');
    this.listen(C);
  }

  stop() {
    this.running = false;
    this.announced = false;
    this.rec?.abort();
    this.rec = null;
    this.emit('status', 'stopped');
  }

  private listen(C: Ctor) {
    const rec = new C();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.lang;
    if (this.local) {
      rec.processLocally = true;
      rec.options = { langs: [this.lang], processLocally: true };
    }
    // Step-by-step signals for the voice check page.
    rec.onaudiostart = () => this.emit('diag', 'audiostart');
    rec.onsoundstart = () => this.emit('diag', 'soundstart');
    rec.onspeechstart = () => {
      this.emit('diag', 'speechstart');
      // Speech detected but no words back: the speech service isn't answering.
      clearTimeout(this.silenceTimer);
      this.silenceTimer = setTimeout(() => {
        if (this.running && !this.resultsThisSession) this.emit('error', 'no-results');
      }, 7000);
    };
    this.resultsThisSession = false;
    this.heardCount = 0;
    this.baseline = 0;
    this.lastText = '';
    rec.onresult = (e) => this.onResult(e);
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.emit('error', e.error);
      // These won't fix themselves by restarting.
      if (['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(e.error)) this.running = false;
      if (e.error === 'network' && ++this.networkFailures >= 4) this.running = false;
    };
    // Chrome ends a session after silence or about a minute; keep listening. After a
    // network error, wait longer each time before trying again.
    rec.onend = () => {
      if (this.running && this.rec === rec) {
        const wait = this.networkFailures ? 1000 * 2 ** this.networkFailures : 150;
        setTimeout(() => this.running && this.listen(C), wait);
      } else this.emit('status', 'stopped');
    };
    this.rec = rec;
    rec.start();
    if (!this.announced) this.emit('status', 'listening');
    this.announced = true;
  }

  private onResult(e: RecognitionEvent) {
    this.resultsThisSession = true;
    this.networkFailures = 0;
    clearTimeout(this.silenceTimer);
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
      return /Chrome|Edge/.test(browserName()) ? 'Voice follow needs internet' : `${browserName()} can’t reach the speech service`;
    case 'no-results':
      return 'Hearing you, but no words come back';
    case 'local-unsupported':
      return 'On-device voice follow needs Chrome 139+';
    case 'local-not-installed':
      return 'On-device voice not downloaded yet';
    case 'unsupported':
      return 'Voice follow needs Chrome';
    case 'language-not-supported':
      return 'Language not supported';
    default:
      return `Voice follow stopped (${err})`;
  }
}
