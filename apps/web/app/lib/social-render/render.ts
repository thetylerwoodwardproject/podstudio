// Ported from the TWP social generator (tylerwoodward.me, src/lib/social/) so Podstudio's social
// previews are the same drawing. Changes from the original are limited to the `brand` hooks below
// (wordmark, domain, bar color, quote credit), so another show can use it.
// Canvas renderer for the social images. The preview and the exported PNG are the same drawing,
// so what you see is what you post. Sizes are percentages of the image width (the design's cqw).
import { ctaIcons } from './icons';
import { fitLines, paintImagery, place, topHeight, type Layout } from './layout';

export type Template = 'headline' | 'quote';

export interface Format {
  id: string;
  name: string;
  w: number;
  h: number;
  /** Edge padding. */
  pad: number;
  /** Share of the height the art takes in the portrait Split layout. */
  artH: number;
  meta: number;
  head: number;
  mark: number;
  domain: number;
  waveH: number;
  waveW: number;
  waveGap: number;
  quote: number;
  quoteGap: number;
  ep: number;
  listen: number;
  icon: number;
  iconGap: number;
}

export const formats: Format[] = [
  {
    id: 'instagram',
    name: 'Instagram post',
    w: 1080,
    h: 1350,
    pad: 8,
    artH: 0.56,
    meta: 3.6,
    head: 10,
    mark: 3.6,
    domain: 3.8,
    waveH: 9,
    waveW: 1.4,
    waveGap: 1,
    quote: 7.4,
    quoteGap: 4,
    ep: 7,
    listen: 3.8,
    icon: 5.4,
    iconGap: 3.2,
  },
  {
    id: 'x',
    name: 'X',
    w: 1600,
    h: 900,
    pad: 5.5,
    artH: 1,
    meta: 2.2,
    head: 6.2,
    mark: 2.2,
    domain: 2.4,
    waveH: 5.5,
    waveW: 0.8,
    waveGap: 0.6,
    quote: 4.6,
    quoteGap: 2.4,
    ep: 4.6,
    listen: 2.4,
    icon: 3.4,
    iconGap: 2,
  },
  {
    id: 'facebook',
    name: 'Facebook',
    w: 1200,
    h: 630,
    pad: 5,
    artH: 1,
    meta: 2,
    head: 5.6,
    mark: 2,
    domain: 2.2,
    waveH: 5,
    waveW: 0.75,
    waveGap: 0.55,
    quote: 4.2,
    quoteGap: 2,
    ep: 4.2,
    listen: 2.2,
    icon: 3.1,
    iconGap: 1.8,
  },
];

export interface Scene {
  template: Template;
  headline: string;
  meta: string;
  /** Empty falls back to the headline. */
  quote: string;
  wordmark: 'Stacked' | 'Domain' | 'Logo';
  waveform: boolean;
  /** Where the picture goes (layout.ts). */
  layout: Layout;
  /** Episode art or an upload; null is solid ground whatever the layout. */
  image: CanvasImageSource | null;
  /** 0 to 1: how much ground colour sits over full-frame imagery. */
  dim: number;
}

export const GROUND = '#0e0e0e';
export const INK = '#f5f5f2';
export const SOFT = '#d4d4d0';
export const MUTED = '#8a8a86';
export const SIGNAL = '#c0fc00';
export const TRACK = '#262626';
// `let`, so setBrand can swap the headline face; importers read the live binding at draw time.
export let SANS = 'Archivo, "Archivo Fallback", sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
/** Per-show pieces the TWP original hard-codes. Set before drawing. */
export const brand = {
  stacked: ['TYLER', 'WOODWARD', 'PROJECT'] as string[],
  domain: 'tylerwoodward.me',
  signal: SIGNAL as string,
  speaker: 'Tyler Woodward',
  /** Headline face (TWP: Archivo). */
  sans: SANS,
  /** Wordmark face, weight and tracking (TWP: bold JetBrains Mono, 6% tracking when stacked). */
  markFamily: MONO,
  markWeight: 700,
  markSpacing: 0.06,
  /** Drawn in the wordmark's place when the wordmark is 'Logo'. */
  logo: null as CanvasImageSource | null,
  /** Listening-platform glyphs (24×24 paths): the top-right corner and the carousel's listen slide. */
  icons: ctaIcons.map((i) => ({ name: i.name, d: i.d })) as { name: string; d: string }[],
  /** Whether the icons sit in the top-right corner of posts. */
  cornerIcons: true,
  iconColor: INK as string,
};
export function setBrand(b: Partial<typeof brand>) {
  Object.assign(brand, b);
  SANS = brand.sans;
}

export const BARS = [30, 55, 40, 72, 50, 88, 62, 100, 70, 46, 84, 56, 94, 40, 64, 34, 50];

/** Faces the renderer draws with; load them before the first draw or the canvas falls back. */
export const fontSpecs = [
  '500 20px Archivo',
  '400 20px "JetBrains Mono"',
  '700 20px "JetBrains Mono"',
];

export interface Row {
  h: number;
  draw: (y: number) => void;
}

const sizeOf = (src: CanvasImageSource) =>
  src instanceof HTMLImageElement
    ? { w: src.naturalWidth, h: src.naturalHeight }
    : { w: (src as HTMLCanvasElement).width, h: (src as HTMLCanvasElement).height };

export function cover(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const s = sizeOf(src);
  if (!s.w || !s.h) return;
  const k = Math.max(w / s.w, h / s.h);
  const sw = w / k,
    sh = h / k;
  ctx.drawImage(src, (s.w - sw) / 2, (s.h - sh) / 2, sw, sh, x, y, w, h);
}

export function setFont(
  ctx: CanvasRenderingContext2D,
  weight: number,
  size: number,
  family: string,
  spacing = 0,
) {
  ctx.font = `${weight} ${size}px ${family}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing * size}px`;
}

/** Natural height of one line in the current font. */
export function lineBox(ctx: CanvasRenderingContext2D) {
  const m = ctx.measureText('Hg');
  return m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
}

/** Draws one line inside a box `lh` tall, the way CSS centres a glyph run in its line-height. */
export function line(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  top: number,
  lh: number,
) {
  const m = ctx.measureText('Hg');
  const y =
    top + (lh - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
  ctx.fillText(text, x, y);
}

function greedy(ctx: CanvasRenderingContext2D, words: string[], max: number) {
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(next).width > max) {
      out.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

/** Word wrap; `balance` narrows the measure until the line count would change (text-wrap: balance). */
export function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, balance = true) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = greedy(ctx, words, max);
  if (!balance || lines.length < 2) return lines;
  let lo = max / 2,
    hi = max;
  while (hi - lo > 1) {
    const mid = (lo + hi) / 2;
    if (greedy(ctx, words, mid).length > lines.length) lo = mid;
    else hi = mid;
  }
  return greedy(ctx, words, hi);
}

export function clip(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}

/** Header, body and footer of a column, spread top to bottom with a minimum gap. */
export function spread(
  box: { x: number; y: number; w: number; h: number },
  rows: Row[],
  minGap: number,
) {
  const free = box.h - rows.reduce((a, r) => a + r.h, 0);
  const gap = Math.max(free / (rows.length - 1), minGap);
  let y = box.y;
  for (const r of rows) {
    r.draw(y);
    y += r.h + gap;
  }
}

export function icons(
  ctx: CanvasRenderingContext2D,
  right: number,
  top: number,
  h: number,
  size: number,
  gap: number,
) {
  const list = brand.icons;
  const total = list.length * size + (list.length - 1) * gap;
  let x = right - total;
  ctx.fillStyle = brand.iconColor;
  for (const i of list) {
    ctx.save();
    ctx.translate(x, top + (h - size) / 2);
    ctx.scale(size / 24, size / 24);
    ctx.fill(new Path2D(i.d));
    ctx.restore();
    x += size + gap;
  }
}

export function draw(canvas: HTMLCanvasElement, f: Format, s: Scene) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = f.w,
    H = f.h,
    u = W / 100;
  canvas.width = W;
  canvas.height = H;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, W, H);

  const p = f.pad * u;
  const a = paintImagery(ctx, W, H, s.layout, s.image, { pad: p, dim: s.dim, artH: f.artH });
  const box = a.box;
  // Split is the old Episode art post: tighter gaps and the listen line instead of the wordmark.
  const split = s.layout === 'split' && !!s.image;
  const gap = (split ? 2 : 3) * u;

  setFont(ctx, 400, f.meta * u, MONO);
  const mlh = lineBox(ctx);
  const showIcons = a.icons && brand.cornerIcons && brand.icons.length > 0;
  const ic = showIcons ? f.icon * u : 0;
  const metaH = Math.max(mlh, ic);
  const top: Row = {
    h: metaH,
    draw: (y) => {
      setFont(ctx, 400, f.meta * u, MONO);
      ctx.fillStyle = MUTED;
      const width = box.w - a.topInset;
      const n = brand.icons.length;
      const room = width - (showIcons ? ic * n + f.iconGap * u * (n - 1) + 2 * u : 0);
      line(ctx, clip(ctx, s.meta, room), box.x, y + (metaH - mlh) / 2, mlh);
      if (showIcons) icons(ctx, box.x + width, y, metaH, ic, f.iconGap * u);
    },
  };

  let foot: Row;
  if (split) {
    setFont(ctx, 400, f.listen * u, SANS);
    const llh = lineBox(ctx);
    foot = {
      h: llh,
      draw: (y) => {
        setFont(ctx, 400, f.listen * u, SANS);
        ctx.fillStyle = INK;
        line(ctx, `Listen at ${brand.domain} →`, box.x, y, llh);
      },
    };
  } else foot = footer(ctx, f, s, box);

  // What the headline or quote may fill, after the rows that share its box.
  const used = topHeight(a, top.h) + gap + (a.foot ? 0 : foot.h + gap);
  const room = box.h - used;
  // Narrow text columns start smaller, so a landscape panel doesn't shrink a huge size to fit.
  const scale = Math.min(1, Math.max(0.7, box.w / (W - p * 2)));

  let mid: Row;
  if (s.template === 'headline') {
    const fit = fitLines(ctx, s.headline, box.w, room, split ? f.ep * u : f.head * u * scale, {
      weight: 500,
      family: SANS,
      spacing: split ? -0.02 : -0.025,
      lh: split ? 1.1 : 1.08,
      min: f.ep * u * 0.6,
    });
    mid = {
      h: fit.lines.length * fit.lh,
      draw: (y) => {
        setFont(ctx, 500, fit.size, SANS, split ? -0.02 : -0.025);
        ctx.fillStyle = INK;
        fit.lines.forEach((t, i) => line(ctx, t, box.x, y + i * fit.lh, fit.lh));
      },
    };
  } else {
    setFont(ctx, 400, f.meta * u, MONO);
    const by = lineBox(ctx);
    const qgap = f.quoteGap * u;
    const fit = fitLines(
      ctx,
      `“${s.quote.trim() || s.headline}”`,
      box.w,
      room - qgap - by,
      f.quote * u * scale,
      {
        weight: 500,
        family: SANS,
        spacing: -0.015,
        lh: 1.22,
        min: f.quote * u * 0.5,
        indent: 0.42,
      },
    );
    const indent = 0.42 * fit.size;
    mid = {
      h: fit.lines.length * fit.lh + qgap + by,
      draw: (y) => {
        setFont(ctx, 500, fit.size, SANS, -0.015);
        ctx.fillStyle = INK;
        fit.lines.forEach((t, i) =>
          line(ctx, t, box.x - (i === 0 ? indent : 0), y + i * fit.lh, fit.lh),
        );
        setFont(ctx, 400, f.meta * u, MONO);
        ctx.fillStyle = SOFT;
        line(ctx, brand.speaker, box.x, y + fit.lines.length * fit.lh + qgap, by);
      },
    };
  }

  place(a, [top, mid], [foot], gap);
}

/** The parts of a format the footer reads, so other renderers can reuse it. */
export type FooterFormat = Pick<Format, 'w' | 'mark' | 'domain' | 'waveH' | 'waveW' | 'waveGap'>;

export function footer(
  ctx: CanvasRenderingContext2D,
  f: FooterFormat,
  s: Pick<Scene, 'wordmark' | 'waveform'>,
  box: { x: number; y: number; w: number; h: number },
): Row {
  const u = f.w / 100;
  const waveH = s.waveform ? f.waveH * u : 0;
  const bw = f.waveW * u,
    wgap = f.waveGap * u;
  const waveW = s.waveform ? BARS.length * bw + (BARS.length - 1) * wgap : 0;
  // Room left of the waveform: a long name shrinks to fit rather than running into the bars.
  const avail = box.w - (waveW ? waveW + 3 * u : 0);
  const logo = s.wordmark === 'Logo' ? brand.logo : null;
  const stacked = s.wordmark === 'Stacked' || (s.wordmark === 'Logo' && !logo);
  const lines = stacked ? brand.stacked : [brand.domain];
  const spacing = stacked ? brand.markSpacing : 0;
  let size = (stacked ? f.mark : f.domain) * u;
  let textH: number;
  let logoW = 0;
  if (logo) {
    // A logo takes the stacked wordmark's three-line height, never stretched, never past the bars.
    const n = sizeOf(logo);
    textH = f.mark * u * 1.08 * 3;
    logoW = n.h ? (n.w / n.h) * textH : 0;
    if (logoW > avail) {
      textH *= avail / logoW;
      logoW = avail;
    }
  } else {
    const min = size * 0.5;
    for (;;) {
      setFont(ctx, brand.markWeight, size, brand.markFamily, spacing);
      const widest = Math.max(0, ...lines.map((t) => ctx.measureText(t).width));
      if (widest <= avail || size <= min) break;
      size *= 0.94;
    }
    textH = stacked ? size * 1.08 * lines.length : lineBox(ctx);
  }
  const h = Math.max(textH, waveH);
  return {
    h,
    draw: (y) => {
      const bottom = y + h;
      if (logo) {
        ctx.drawImage(logo, box.x, bottom - textH, logoW, textH);
      } else {
        setFont(ctx, brand.markWeight, size, brand.markFamily, spacing);
        ctx.fillStyle = INK;
        if (stacked) {
          lines.forEach((t, i) => line(ctx, t, box.x, bottom - textH + i * size * 1.08, size * 1.08));
        } else line(ctx, brand.domain, box.x, bottom - textH, textH);
      }
      if (!s.waveform) return;
      let x = box.x + box.w - waveW;
      ctx.fillStyle = brand.signal;
      for (const pct of BARS) {
        const bh = (pct / 100) * waveH;
        ctx.beginPath();
        ctx.roundRect(x, bottom - waveH + (waveH - bh) / 2, bw, bh, bw / 2);
        ctx.fill();
        x += bw + wgap;
      }
    },
  };
}
