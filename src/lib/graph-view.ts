/*
 * Draws a frequency graph (framework: Graphs & calibration) into a
 * <FreqGraph>: the plot, grid and labels, then the live spectrum behind the
 * target and measured curves. Redraws when the box changes size, so labels
 * stay mono 10 at any width.
 */
import { FREQ_LABELS, curvePath, dbLabel, dbLines, dbPos, freqGrid, freqLabel, freqPos, type Point } from './graph';

export interface GraphData {
  /** Always drawn in text, 2px */
  target?: Point[];
  /** One per channel, in its speaker colour, 2px */
  measured?: { points: Point[]; color: string }[];
  /** Thin amber line, red at the extremes, behind the curves */
  spectrum?: Point[];
}

const NS = 'http://www.w3.org/2000/svg';
const LEFT = 34;
const BOTTOM = 22;
const TOP = 8;
const RIGHT = 8;
let gradients = 0;

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>, parent?: Element) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.append(e);
  return e;
}

export function mountGraph(root: HTMLElement) {
  const box = root.querySelector<HTMLElement>('[data-graph-plot]')!;
  const svg = el('svg', { width: '100%', height: '100%', role: 'img', 'aria-label': root.dataset.graphLabel ?? 'Frequency response' });
  box.append(svg);
  const gid = `graph-spectrum-${++gradients}`;
  let data: GraphData = {};

  const draw = () => {
    const W = box.clientWidth;
    const H = box.clientHeight;
    if (!W || !H) return;
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const w = W - LEFT - RIGHT;
    const h = H - TOP - BOTTOM;
    const x = (f: number) => LEFT + freqPos(f) * w;
    const y = (d: number) => TOP + dbPos(d) * h;

    const defs = el('defs', {}, svg);
    const grad = el('linearGradient', { id: gid, x1: 0, x2: w, y1: 0, y2: 0, gradientUnits: 'userSpaceOnUse' }, defs);
    for (const [o, c] of [[0, 'var(--color-rec)'], [0.08, 'var(--color-warn)'], [0.9, 'var(--color-warn)'], [1, 'var(--color-rec)']] as const)
      el('stop', { offset: o, 'stop-color': c }, grad);

    el('rect', { x: LEFT, y: TOP, width: w, height: h, fill: 'var(--color-plot)' }, svg);
    const { major, minor } = freqGrid();
    for (const f of minor) el('line', { x1: x(f), x2: x(f), y1: TOP, y2: TOP + h, stroke: 'var(--color-divider)' }, svg);
    for (const f of major) el('line', { x1: x(f), x2: x(f), y1: TOP, y2: TOP + h, stroke: 'var(--color-border)' }, svg);
    for (const d of dbLines())
      el('line', { x1: LEFT, x2: LEFT + w, y1: y(d), y2: y(d), stroke: d === 0 ? 'var(--color-handle)' : 'var(--color-border)' }, svg);

    const label = (text: string, attrs: Record<string, string | number>) => {
      const t = el('text', { fill: 'var(--color-text-3)', 'font-family': 'var(--font-mono)', 'font-size': 10, ...attrs }, svg);
      t.textContent = text;
    };
    for (const d of dbLines()) if (Math.abs(d) < 24) label(dbLabel(d), { x: LEFT - 6, y: y(d) + 3.5, 'text-anchor': 'end' });
    // At narrow widths, only every other frequency label.
    const labels = w < 360 ? FREQ_LABELS.filter((_, i) => i % 2 === 1) : FREQ_LABELS;
    for (const f of labels) label(freqLabel(f), { x: x(f), y: TOP + h + 15, 'text-anchor': 'middle' });

    const plot = el('g', { transform: `translate(${LEFT} ${TOP})` }, svg);
    el('clipPath', { id: `${gid}-clip` }, defs).append(el('rect', { width: w, height: h }));
    plot.setAttribute('clip-path', `url(#${gid}-clip)`);
    const path = (points: Point[], stroke: string, width: number, extra: Record<string, string | number> = {}) =>
      el('path', { d: curvePath(points, w, h), fill: 'none', stroke, 'stroke-width': width, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...extra }, plot);
    if (data.spectrum?.length) path(data.spectrum, `url(#${gid})`, 1.25, { opacity: 0.85, 'data-spectrum': '' });
    if (data.target?.length) path(data.target, 'var(--color-text)', 2, { 'data-target': '' });
    for (const m of data.measured ?? []) if (m.points.length) path(m.points, m.color, 2, { 'data-measured': '' });
  };

  new ResizeObserver(draw).observe(box);
  return {
    set(next: GraphData) {
      data = { ...data, ...next };
      draw();
    },
  };
}
