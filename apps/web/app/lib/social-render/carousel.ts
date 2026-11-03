// Ported from the TWP social generator (tylerwoodward.me, src/lib/social/) so Podstudio's social
// previews are the same drawing. Changes from the original are limited to the `brand` hooks below
// (wordmark, domain, bar color, quote credit), so another show can use it.
// Canvas renderer for the Instagram carousel. Same palette, fonts and percent-of-width scale as
// render.ts, so a slide sits next to the single-image Instagram post without looking foreign.
import {
  GROUND,
  INK,
  MONO,
  MUTED,
  SANS,
  SOFT,
  brand,
  clip,
  footer,
  formats,
  icons,
  line,
  lineBox,
  setFont,
  wrap,
  type Row,
  type Scene,
} from './render';
import { fitLines, paintImagery, place, topHeight, type Layout } from './layout';

export type SlideType = 'cover' | 'text' | 'quote' | 'cta';

export interface Slide {
  id: number;
  type: SlideType;
  /** Cover and CTA headline, text-slide heading. Unused by quote slides. */
  heading: string;
  /** Cover meta line, text body, pull quote, or the CTA's line under the headline. */
  body: string;
}

export interface CarouselOptions {
  wordmark: 'Stacked' | 'Domain' | 'Logo';
  waveform: boolean;
  numbers: boolean;
  swipe: boolean;
  /** Cover image; null is solid ground. Only the cover slide shows it. */
  art: CanvasImageSource | null;
  /** Where the cover's image goes (layout.ts). */
  layout: Layout;
  /** 0 to 1: how much ground colour sits over full-frame imagery. */
  dim: number;
}

export const slideTypes: Record<string, SlideType> = {
  Cover: 'cover',
  Text: 'text',
  Quote: 'quote',
  'Listen CTA': 'cta',
};

export const SLIDE_W = 1080;
export const SLIDE_H = 1350;
export const MAX_SLIDES = 10;

const f = formats[0];

export function drawSlide(
  canvas: HTMLCanvasElement,
  slide: Slide,
  position: number,
  total: number,
  o: CarouselOptions,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = SLIDE_W,
    H = SLIDE_H,
    u = W / 100;
  canvas.width = W;
  canvas.height = H;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, W, H);

  const p = f.pad * u;
  // Imagery on the cover only: behind body copy it would fight the words.
  const isCover = slide.type === 'cover';
  const a = paintImagery(ctx, W, H, isCover ? o.layout : 'none', o.art, {
    pad: p,
    dim: o.dim,
    artH: f.artH,
  });
  const box = a.box;

  // Top row: slide counter on the left, swipe cue on the cover's right.
  setFont(ctx, 400, f.meta * u, MONO);
  const topH = lineBox(ctx);
  const top: Row = {
    h: topH,
    draw: (y) => {
      setFont(ctx, 400, f.meta * u, MONO);
      ctx.fillStyle = MUTED;
      const width = box.w - a.topInset;
      const right = slide.type === 'cover' && o.swipe && total > 1 ? 'Swipe →' : '';
      const rightW = right ? ctx.measureText(right).width + 3 * u : 0;
      const left =
        slide.type === 'cover'
          ? clip(ctx, slide.body, width - rightW)
          : o.numbers
            ? `${pad(position + 1)} / ${pad(total)}`
            : '';
      if (left) line(ctx, left, box.x, y, topH);
      if (right) {
        ctx.fillStyle = INK;
        line(ctx, right, box.x + width - ctx.measureText(right).width, y, topH);
      }
    },
  };

  const scene = { wordmark: o.wordmark, waveform: o.waveform } as Scene;
  const foot = footer(ctx, f, scene, box);
  const gap = 3 * u;
  const room = box.h - topHeight(a, top.h) - gap - (a.foot ? 0 : foot.h + gap);
  place(a, [top, middle(ctx, slide, box, u, room)], [foot], gap);
}

const pad = (n: number) => String(n).padStart(2, '0');

function middle(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  box: { x: number; y: number; w: number; h: number },
  u: number,
  room: number,
): Row {
  switch (slide.type) {
    case 'cover':
      return block(ctx, box, u, { heading: slide.heading, size: f.head * 1.15, body: '' }, room);
    case 'text':
      return block(ctx, box, u, { heading: slide.heading, size: 7.4, body: slide.body });
    case 'quote': {
      const q = f.quote * u,
        lh = q * 1.22,
        indent = 0.42 * q;
      setFont(ctx, 500, q, SANS, -0.015);
      const lines = wrap(ctx, `“${slide.body.trim() || slide.heading}”`, box.w + indent);
      setFont(ctx, 400, f.meta * u, MONO);
      const by = lineBox(ctx);
      return {
        h: lines.length * lh + f.quoteGap * u + by,
        draw: (y) => {
          setFont(ctx, 500, q, SANS, -0.015);
          ctx.fillStyle = INK;
          lines.forEach((t, i) => line(ctx, t, box.x - (i === 0 ? indent : 0), y + i * lh, lh));
          setFont(ctx, 400, f.meta * u, MONO);
          ctx.fillStyle = SOFT;
          line(ctx, brand.speaker, box.x, y + lines.length * lh + f.quoteGap * u, by);
        },
      };
    }
    case 'cta': {
      const text = block(ctx, box, u, { heading: slide.heading, size: f.head, body: slide.body });
      const ic = f.icon * 1.25 * u,
        gap = f.iconGap * u,
        space = 4 * u;
      return {
        h: text.h + space + ic,
        draw: (y) => {
          text.draw(y);
          // icons() right-aligns, so hand it the right edge of the three-icon run.
          const run = 3 * ic + 2 * gap;
          icons(ctx, box.x + run, y + text.h + space, ic, ic, gap);
        },
      };
    }
  }
}

/** A heading with an optional body paragraph under it. */
function block(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  u: number,
  c: { heading: string; size: number; body: string },
  room = Infinity,
): Row {
  // Only the cover passes a room: its heading shrinks to clear the layout's imagery.
  const fit = fitLines(ctx, c.heading, box.w, room, c.size * u, {
    weight: 500,
    family: SANS,
    spacing: -0.025,
    lh: 1.08,
    min: c.size * u * 0.5,
  });
  const hs = fit.size,
    hl = fit.lh,
    head = fit.lines;
  const bs = 4.2 * u,
    bl = bs * 1.4,
    gap = 3 * u;
  setFont(ctx, 400, bs, SANS);
  const body = wrap(ctx, c.body, box.w, false);
  return {
    h: head.length * hl + (body.length ? gap + body.length * bl : 0),
    draw: (y) => {
      setFont(ctx, 500, hs, SANS, -0.025);
      ctx.fillStyle = INK;
      head.forEach((t, i) => line(ctx, t, box.x, y + i * hl, hl));
      setFont(ctx, 400, bs, SANS);
      ctx.fillStyle = SOFT;
      const by = y + head.length * hl + gap;
      body.forEach((t, i) => line(ctx, t, box.x, by + i * bl, bl));
    },
  };
}
