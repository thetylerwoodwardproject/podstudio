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
    this.resize = new ResizeObserver(() => this.scroll());
    this.resize.observe(viewport);
  }

  private resize: ResizeObserver;

  /** Stop following the viewport's size (before replacing this prompter). */
  destroy() {
    this.resize.disconnect();
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

  /** Scroll by hand (wheel, trackpad, drag) to look at other lines. The next word snaps back. */
  nudge(dy: number) {
    const lineY = this.viewport.clientHeight * this.lineAt;
    this.track.style.transition = 'none';
    this.offset = Math.max(lineY - this.track.offsetHeight, Math.min(lineY, this.offset + dy));
    this.apply();
  }

  private scroll() {
    const w = this.words[Math.min(this.index, this.words.length - 1)];
    if (!w) return;
    this.track.style.transition = '';
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

/**
 * Let the reader scroll a prompter by hand: wheel or trackpad, or drag on a
 * touch screen. A drag doesn't count as a tap on the line under it.
 */
export function enableHandScroll(p: Prompter, viewport: HTMLElement) {
  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      p.nudge(-e.deltaY);
    },
    { passive: false },
  );
  viewport.style.touchAction = 'none';
  let lastY: number | null = null;
  let moved = 0;
  viewport.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    lastY = e.clientY;
    moved = 0;
  });
  viewport.addEventListener('pointermove', (e) => {
    if (lastY == null) return;
    const dy = e.clientY - lastY;
    moved += Math.abs(dy);
    lastY = e.clientY;
    p.nudge(dy);
  });
  const end = () => {
    if (lastY != null && moved > 8) {
      // Swallow the click that ends a drag.
      viewport.addEventListener('click', (e) => e.stopPropagation(), { capture: true, once: true });
    }
    lastY = null;
  };
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('pointercancel', end);
}
