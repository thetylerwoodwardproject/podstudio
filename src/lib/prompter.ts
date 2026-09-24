/*
 * Prompter view: marks each word as past / now / next and scrolls so the
 * current word sits on the reading line.
 *
 * Voice follow will call setWord() from Chrome's speech recognition
 * results. Until that exists, startDemo() advances at a steady speaking pace.
 *
 * Markup:
 *   <div data-prompter-viewport>            (overflow hidden, positioned)
 *     <div data-prompter-track>             (translated by this module)
 *       … <span data-word>…</span> …
 *       optional wrappers: <div data-line>…words…</div>
 */

export interface PrompterOptions {
  /** Reading line position, as a fraction of the viewport height */
  line?: number;
  mirror?: boolean;
}

export class Prompter {
  readonly words: HTMLElement[];
  readonly lines: HTMLElement[];
  index = 0;
  private offset = 0;
  private lineAt: number;
  private mirrored: boolean;

  constructor(
    private viewport: HTMLElement,
    private track: HTMLElement,
    opts: PrompterOptions = {},
  ) {
    this.words = [...track.querySelectorAll<HTMLElement>('[data-word]')];
    this.lines = [...track.querySelectorAll<HTMLElement>('[data-line]')];
    this.lineAt = opts.line ?? 0.34;
    this.mirrored = opts.mirror ?? false;
    new ResizeObserver(() => this.scroll()).observe(viewport);
  }

  get length() {
    return this.words.length;
  }

  setWord(i: number) {
    this.index = Math.max(0, Math.min(i, this.words.length));
    this.words.forEach((w, j) => (w.dataset.w = j < this.index ? 'past' : j === this.index ? 'now' : 'next'));
    const current = this.words[this.index];
    for (const line of this.lines) {
      const inLine = current ? line.contains(current) : false;
      const before = current ? !!(line.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING) && !inLine : true;
      line.dataset.l = inLine ? 'now' : before ? 'past' : 'next';
    }
    this.scroll();
    this.viewport.dispatchEvent(new CustomEvent('word', { detail: this.index }));
  }

  /** Index of the first word in a line, for tap-to-jump. */
  lineStart(line: HTMLElement) {
    const first = line.querySelector<HTMLElement>('[data-word]');
    return first ? this.words.indexOf(first) : 0;
  }

  setMirror(on: boolean) {
    this.mirrored = on;
    this.apply();
  }

  get mirror() {
    return this.mirrored;
  }

  private scroll() {
    const w = this.words[Math.min(this.index, this.words.length - 1)];
    if (!w) return;
    const lineY = this.viewport.clientHeight * this.lineAt;
    this.offset = Math.round(lineY - (w.offsetTop + w.offsetHeight * 0.78));
    this.apply();
  }

  private apply() {
    this.track.style.transform = `translateY(${this.offset}px) scaleX(${this.mirrored ? -1 : 1})`;
  }
}

/** Split text into word spans; returns HTML-safe nodes for server rendering. */
export const splitWords = (text: string) => text.split(/\s+/).filter(Boolean);

/**
 * Stand-in for voice follow: one word every `interval` ms, a short hold at
 * the end, then start over. `paused()` lets a screen hold its place (for
 * example while voice follow has lost the reader).
 */
export function startDemo(p: Prompter, opts: { interval?: number; hold?: number; paused?: () => boolean } = {}) {
  const { interval = 330, hold = 6, paused = () => false } = opts;
  let held = 0;
  p.setWord(p.index);
  return window.setInterval(() => {
    if (paused()) return;
    if (p.index < p.length) return p.setWord(p.index + 1);
    if (++held >= hold) {
      held = 0;
      p.setWord(0);
    }
  }, interval);
}

/** Recording clock that ticks from a starting time, e.g. "12:48". */
export function startClock(els: HTMLElement[], startSeconds: number, paused: () => boolean = () => false) {
  let t = startSeconds;
  const fmt = () => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  els.forEach((e) => (e.textContent = fmt()));
  return window.setInterval(() => {
    if (paused()) return;
    t += 1;
    els.forEach((e) => (e.textContent = fmt()));
  }, 1000);
}
