/*
 * Voice follow on Chrome's speech recognition (Web Speech API). Chrome sends
 * the audio to Google to transcribe it, so this needs an internet connection.
 *
 * Events:
 *   "word"   detail: index of the script word just spoken (display word index)
 *   "lost"   the reader has gone off script (an ad-lib, or skipped ahead); detail:
 *            { since: ms timestamp of the first off-script word, manual: boolean }
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
  /** Chrome: start(track) listens to that audio track instead of the default mic */
  start(track?: MediaStreamTrack): void;
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
  if (/CriOS/.test(navigator.userAgent)) return 'Chrome on iOS';
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return 'iOS browser';
  const brands = nav.userAgentData?.brands.map((b) => b.brand) ?? [];
  const named = brands.find((b) => !/Chromium|Not.?A.?Brand/i.test(b));
  if (named) return named;
  if (/Edg\//.test(navigator.userAgent)) return 'Microsoft Edge';
  if (brands.includes('Chromium')) return 'Chromium-based browser';
  return 'This browser';
}

/** Words heard off script before voice follow calls it an ad-lib and holds the reader's place. */
const LOST_AFTER_WORDS = 6;
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
  /**
   * The mic to listen to (the same input that's being recorded). Without it,
   * Chrome listens to the system default mic, which may be a different device.
   */
  track: MediaStreamTrack | null = null;
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
  /** When the current run of off-script words started */
  private offSince = 0;
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

  /** The host marked an ad-lib: hold the reader's place until the script resumes. */
  holdAdlib() {
    if (this.lost) return;
    this.lost = true;
    this.offScript = LOST_AFTER_WORDS;
    this.emit('lost', { since: Date.now(), manual: true });
  }

  /**
   * Cough: ignore everything heard until mute(false), so it can't move the
   * reader or start an ad-lib.
   */
  mute(on: boolean) {
    this.muted = on;
    this.baseline = this.heardCount;
    this.offScript = 0;
  }
  private muted = false;

  /** End an ad-lib by hand (the script may not have resumed yet). */
  release() {
    if (!this.lost) return;
    this.lost = false;
    this.offScript = 0;
    this.emit('found');
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
    try {
      this.listen(C);
    } catch (err) {
      this.emit('diag', `start failed: ${(err as Error).message}`);
      this.restart(1000);
    }
  }

  /** Listen to a different mic from now on. */
  setTrack(track: MediaStreamTrack | null) {
    this.track = track;
    if (this.running) this.rec?.abort(); // onend restarts on the new track
  }

  stop() {
    this.running = false;
    clearTimeout(this.retryTimer);
    this.announced = false;
    this.rec?.abort();
    this.rec = null;
    this.emit('status', 'stopped');
  }

  /** When recognition last returned words (ms, Date.now) */
  lastResultAt = 0;
  /** Recognition sessions restarted after an error, a stall or Chrome ending one */
  restarts = 0;
  private C: Ctor | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Start a fresh recognition session now: after a stall (hearing speech but no
   * words back), or when the person taps Restart. Keeps the place in the script.
   */
  kick(reason = 'kick') {
    if (!this.C) return;
    this.running = true;
    this.emit('diag', reason);
    clearTimeout(this.retryTimer);
    const old = this.rec;
    this.rec = null;
    try {
      old?.abort();
    } catch {}
    this.restart(0);
  }

  /** Listen again after `wait` ms, and keep trying if starting fails. */
  private restart(wait: number) {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (!this.running || !this.C) return;
      this.restarts++;
      try {
        this.listen(this.C);
      } catch (err) {
        this.emit('diag', `start failed: ${(err as Error).message}`);
        this.networkFailures++;
        this.emit('status', 'reconnecting');
        this.restart(this.backoff());
      }
    }, wait);
  }

  /** 1, 2, 4, 8… seconds, at most 30. */
  private backoff() {
    return Math.min(30000, 1000 * 2 ** Math.max(0, this.networkFailures - 1));
  }

  private listen(C: Ctor) {
    this.C = C;
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
        if (this.running && !this.resultsThisSession && this.rec === rec) {
          this.emit('error', 'no-results');
          this.kick('stalled');
        }
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
      if (['not-allowed', 'service-not-allowed', 'language-not-supported'].includes(e.error)) this.running = false;
      // A network hiccup (or the mic briefly gone): keep trying, waiting longer each time.
      if (e.error === 'network' || e.error === 'audio-capture') {
        this.networkFailures++;
        this.emit('status', 'reconnecting');
      }
    };
    // Chrome ends a session after silence or about a minute; keep listening.
    rec.onend = () => {
      if (this.rec !== rec) return; // replaced by kick()
      if (this.running) this.restart(this.networkFailures ? this.backoff() : 150);
      else this.emit('status', 'stopped');
    };
    this.rec = rec;
    const track = this.track?.readyState === 'live' ? this.track : null;
    try {
      if (track) rec.start(track);
      else rec.start();
    } catch {
      // Older Chrome without track support: fall back to the default mic, which Chrome
      // opens with its own auto gain. Say so: it can change the default mic's level.
      rec.start();
      this.emit('diag', 'default-mic');
    }
    if (!this.announced || this.networkFailures) this.emit('status', 'listening');
    this.announced = true;
  }

  private onResult(e: RecognitionEvent) {
    this.resultsThisSession = true;
    this.lastResultAt = Date.now();
    if (this.networkFailures) {
      this.networkFailures = 0;
      this.emit('status', 'listening');
    }
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
    if (this.muted) {
      this.baseline = this.heardCount;
      return;
    }

    const usable = words.slice(Math.min(this.baseline, words.length));
    if (!usable.length) return;
    // After an ad-lib the reader may carry on anywhere, but only words heard in script
    // order bring them back, so talk that happens to share a word can't.
    const hit = locate(this.tokens, usable.slice(-TAIL), this.cursor, {
      ahead: this.lost ? 400 : 60,
      behind: this.lost ? 400 : 12,
      strict: this.lost,
    });
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
      if (!this.offScript && fresh) this.offSince = Date.now();
      this.offScript += fresh;
      if (!this.lost && this.offScript >= LOST_AFTER_WORDS) {
        this.lost = true;
        this.emit('lost', { since: this.offSince, manual: false });
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
