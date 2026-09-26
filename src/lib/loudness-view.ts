/*
 * The loudness card (components/app/LoudnessCard.astro): readouts, the
 * momentary bar against the target, and short-term loudness over time on the
 * framework's graph (plot area, grid, the target in text with a ±1 LU band).
 */
const NS = 'http://www.w3.org/2000/svg';
const minus = (s: string) => s.replace(/-/g, '−');
const fmt = (d: number | null | undefined, digits = 1) => (d != null && Number.isFinite(d) ? minus(d.toFixed(digits)) : '—');
function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>, parent?: Element) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.append(e);
  return e;
}
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export interface LoudnessReading {
  integrated: number;
  short: number;
  momentary: number;
  range: number | null;
  peak: number;
  /** Short-term loudness over the span, evenly spaced */
  history: number[];
  /** Seconds the history covers, and how far along "now" is (for a preview) */
  seconds: number;
  now?: number;
}

export function mountLoudness(root: HTMLElement) {
  const q = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const box = q('[data-loud-plot]');
  let target: number | null = -16;
  let last: LoudnessReading | null = null;

  function plot(r: LoudnessReading | null) {
    const W = box.clientWidth, H = box.clientHeight;
    if (!W || !H) return;
    const L = 34, B = 22, T = 8, R = 8, w = W - L - R, h = H - T - B, lo = -42, hi = -6;
    const y = (d: number) => T + ((hi - Math.max(lo, Math.min(hi, d))) / (hi - lo)) * h;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: '100%', role: 'img', 'aria-label': 'Short-term loudness over time' });
    el('clipPath', { id: 'loud-clip' }, el('defs', {}, svg)).append(el('rect', { x: L, y: T, width: w, height: h }));
    el('rect', { x: L, y: T, width: w, height: h, fill: 'var(--color-plot)' }, svg);
    for (let d = hi; d >= lo; d -= 6) el('line', { x1: L, x2: L + w, y1: y(d), y2: y(d), stroke: 'var(--color-border)' }, svg);
    for (let k = 1; k < 6; k++) el('line', { x1: L + (k / 6) * w, x2: L + (k / 6) * w, y1: T, y2: T + h, stroke: 'var(--color-divider)' }, svg);
    const label = (t: string, a: Record<string, string | number>) => {
      const e = el('text', { fill: 'var(--color-text-3)', 'font-family': 'var(--font-mono)', 'font-size': 10, ...a }, svg);
      e.textContent = t;
    };
    for (let d = hi - 6; d > lo; d -= 6) label(minus(String(d)), { x: L - 6, y: y(d) + 3.5, 'text-anchor': 'end' });
    const secs = r?.seconds ?? 0;
    label('0:00', { x: L, y: T + h + 15 });
    if (secs) label(clock(secs), { x: L + w, y: T + h + 15, 'text-anchor': 'end' });
    const g = el('g', { 'clip-path': 'url(#loud-clip)' }, svg);
    if (target != null) {
      el('rect', { x: L, y: y(target + 1), width: w, height: y(target - 1) - y(target + 1), fill: 'var(--color-ok)', opacity: 0.12 }, g);
      el('line', { x1: L, x2: L + w, y1: y(target), y2: y(target), stroke: 'var(--color-text)', 'stroke-width': 2 }, g);
    }
    if (r && r.history.length > 1) {
      const n = r.history.length;
      const x = (i: number) => L + (i / (n - 1)) * w;
      let first = -1;
      const d = r.history.map((v, i) => (Number.isFinite(v) ? `${first < 0 ? ((first = i), 'M') : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}` : '')).join(' ');
      if (first >= 0) {
        el('path', { d: `${d} L${x(n - 1)} ${y(lo)} L${x(first)} ${y(lo)} Z`, fill: 'var(--color-text)', opacity: 0.05 }, g);
        el('path', { d, fill: 'none', stroke: 'var(--color-text-2)', 'stroke-width': 2, 'stroke-linejoin': 'round' }, g);
      }
      if (r.now != null) el('line', { x1: L + (r.now / secs) * w, x2: L + (r.now / secs) * w, y1: T, y2: T + h, stroke: 'var(--color-text-3)', 'stroke-dasharray': '2 3' }, g);
    }
    box.replaceChildren(svg);
  }

  function show(r: LoudnessReading | null) {
    last = r;
    q('[data-loud-integrated]').textContent = fmt(r?.integrated);
    q('[data-loud-short]').textContent = fmt(r?.short);
    q('[data-loud-momentary]').textContent = fmt(r?.momentary);
    q('[data-loud-range]').textContent = fmt(r?.range);
    q('[data-loud-peak]').textContent = fmt(r?.peak);
    q('[data-loud-target]').textContent = target == null ? 'none' : `${minus(String(target))} LUFS`;
    // Momentary bar: −42 to −6 LUFS; green within 1 LU of the target, amber over, grey under.
    const f = (d: number) => Math.max(0, Math.min(1, (d + 42) / 36));
    const m = r?.momentary ?? -Infinity;
    const bar = q('[data-loud-bar]');
    bar.style.width = `${Number.isFinite(m) ? f(m) * 100 : 0}%`;
    bar.style.background = target != null && m > target + 1 ? 'var(--color-warn)' : target != null && m >= target - 1 ? 'var(--color-ok)' : 'var(--color-text-2)';
    const tick = q('[data-loud-tick]');
    tick.hidden = target == null;
    if (target != null) tick.style.left = `${f(target) * 100}%`;
    plot(r);
  }
  new ResizeObserver(() => plot(last)).observe(box);
  show(null);

  return {
    setTarget(t: number | null) {
      target = t;
      show(last);
    },
    show,
    note(html: string, source = '') {
      q('[data-loud-note]').innerHTML = html;
      q('[data-loud-source]').textContent = source;
    },
  };
}
