// Ported from the TWP social generator (tylerwoodward.me, src/lib/social/) so Podstudio's social
// previews are the same drawing. Changes from the original are limited to the `brand` hooks below
// (wordmark, domain, bar color, quote credit), so another show can use it.
// Imagery layouts shared by the posts, the carousel cover and the reel. Each layout paints the
// picture for any W × H and hands back where the type goes, so every renderer keeps its own rows.
// The studios default to a layout chosen from the episode's place in the archive, so consecutive
// episodes rotate through the five without anyone having to remember which was used last.
import { GROUND, cover, setFont, spread, wrap, type Row } from './render';

export type Layout = 'split' | 'bleed' | 'framed' | 'corner' | 'band' | 'none';

export const layoutLabels: Record<string, Layout> = {
  Split: 'split',
  'Full bleed': 'bleed',
  Framed: 'framed',
  Corner: 'corner',
  Band: 'band',
  None: 'none',
};

/** The cycle the studios step through, one layout per episode. None is never chosen for you. */
export const ROTATION: Layout[] = ['split', 'bleed', 'framed', 'corner', 'band'];

export const labelOf = (l: Layout) =>
  Object.keys(layoutLabels).find((k) => layoutLabels[k] === l) ?? 'None';

/** `ordinal` is the episode's index in the whole archive, oldest first, so it never shifts. */
export const autoLayout = (ordinal: number) =>
  ROTATION[((ordinal % ROTATION.length) + ROTATION.length) % ROTATION.length];

export const autoLabel = (ordinal: number) => labelOf(autoLayout(ordinal));

/** The layouts the Darken slider applies to. */
export const darkens = (l: Layout) => l === 'bleed' || l === 'framed';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Areas {
  /** Where the type goes: the top row, the headline and (unless `foot` is set) the footer. */
  box: Box;
  /** Band's second text area, under the strip, for the footer rows. */
  foot: Box | null;
  /** Width the top row gives up on its right, and its least height (Corner's tile). */
  topInset: number;
  topMinH: number;
  /** Whether the top row has room for the CTA icons. */
  icons: boolean;
}

export interface Frame {
  /** Edge padding in pixels. */
  pad: number;
  /** 0 to 1: how much ground sits over full-frame imagery. */
  dim: number;
  /** Share of the height Split's art takes in portrait. */
  artH: number;
  /** Space the platform's own controls cover (the reel); imagery may sit there, type may not. */
  safeTop?: number;
  safeBottom?: number;
}

const ground = (a: number) => `rgba(14, 14, 14, ${a})`;

function shade(ctx: CanvasRenderingContext2D, W: number, H: number, a: number) {
  ctx.globalAlpha = a;
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
}

let small: HTMLCanvasElement | OffscreenCanvas | null = null;
let mid: HTMLCanvasElement | OffscreenCanvas | null = null;

function scratch(c: HTMLCanvasElement | OffscreenCanvas | null, w: number, h: number) {
  const out =
    c ??
    (typeof document !== 'undefined'
      ? document.createElement('canvas')
      : new OffscreenCanvas(w, h));
  out.width = w;
  out.height = h;
  return out;
}

/**
 * Fills the frame with a heavy blur of `img`. Done by shrinking to a few dozen pixels and scaling
 * back up in two steps rather than with ctx.filter: it is cheap enough for every reel frame and
 * looks the same in every browser.
 */
function blurInto(ctx: CanvasRenderingContext2D, img: CanvasImageSource, W: number, H: number) {
  const sw = 24,
    sh = Math.max(1, Math.round((sw * H) / W));
  small = scratch(small, sw, sh);
  const sc = small.getContext('2d') as CanvasRenderingContext2D | null;
  mid = scratch(mid, sw * 4, sh * 4);
  const mc = mid.getContext('2d') as CanvasRenderingContext2D | null;
  if (!sc || !mc) return;
  sc.imageSmoothingQuality = 'high';
  cover(sc, img, 0, 0, sw, sh);
  mc.imageSmoothingQuality = 'high';
  mc.drawImage(small, 0, 0, sw * 4, sh * 4);
  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mid, 0, 0, W, H);
  ctx.restore();
}

/** Paints the layout's imagery onto a ground-filled frame and returns where the type goes. */
export function paintImagery(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  layout: Layout,
  img: CanvasImageSource | null,
  o: Frame,
): Areas {
  const p = o.pad,
    top = Math.max(p, o.safeTop ?? 0),
    bottom = Math.max(p, o.safeBottom ?? 0);
  const portrait = H > W * 1.05;
  const plain: Areas = {
    box: { x: p, y: top, w: W - p * 2, h: H - top - bottom },
    foot: null,
    topInset: 0,
    topMinH: 0,
    icons: true,
  };
  if (!img || layout === 'none') return plain;

  switch (layout) {
    case 'split': {
      if (portrait) {
        const ah = H * o.artH;
        cover(ctx, img, 0, 0, W, ah);
        const y = ah + p * 0.75;
        const end = H - Math.max(p * 0.875, o.safeBottom ?? 0);
        return { ...plain, box: { x: p, y, w: W - p * 2, h: end - y }, icons: false };
      }
      cover(ctx, img, 0, 0, H, H);
      return { ...plain, box: { x: H + p, y: p, w: W - H - p * 2, h: H - p * 2 }, icons: false };
    }

    case 'bleed': {
      cover(ctx, img, 0, 0, W, H);
      shade(ctx, W, H, o.dim);
      // Ground rises under the headline and footer, and a little falls behind the top row.
      const g = ctx.createLinearGradient(0, H * 0.3, 0, H);
      g.addColorStop(0, ground(0));
      g.addColorStop(1, ground(0.85));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const t = ctx.createLinearGradient(0, 0, 0, H * 0.22);
      t.addColorStop(0, ground(0.5));
      t.addColorStop(1, ground(0));
      ctx.fillStyle = t;
      ctx.fillRect(0, 0, W, H * 0.22);
      return plain;
    }

    case 'framed': {
      blurInto(ctx, img, W, H);
      shade(ctx, W, H, Math.max(o.dim, 0.3));
      if (portrait) {
        const s = Math.min(W - p * 2, plain.box.h * 0.5);
        cover(ctx, img, (W - s) / 2, top, s, s);
        const y = top + s + p * 0.75;
        return { ...plain, box: { x: p, y, w: W - p * 2, h: H - bottom - y } };
      }
      const s = H - p * 2;
      cover(ctx, img, p, p, s, s);
      const x = s + p * 2,
        w = W - x - p;
      return { ...plain, box: { x, y: p, w, h: H - p * 2 }, icons: w > W * 0.55 };
    }

    case 'corner': {
      const t = portrait ? W * 0.24 : H * 0.3;
      cover(ctx, img, W - p - t, top, t, t);
      return { ...plain, topInset: t + p * 0.5, topMinH: t, icons: false };
    }

    case 'band': {
      if (portrait) {
        const bt = top + plain.box.h * 0.42,
          bh = plain.box.h * 0.3,
          gap = p * 0.6;
        cover(ctx, img, 0, bt, W, bh);
        const fy = bt + bh + gap;
        return {
          ...plain,
          box: { x: p, y: top, w: W - p * 2, h: bt - gap - top },
          foot: { x: p, y: fy, w: W - p * 2, h: H - bottom - fy },
        };
      }
      const bw = W * 0.3,
        w = W - bw - p * 2;
      cover(ctx, img, W - bw, 0, bw, H);
      return { ...plain, box: { x: p, y: p, w, h: H - p * 2 }, icons: w > W * 0.55 };
    }
  }
  return plain;
}

/**
 * Lays rows out in the areas: `upper` (top row first) in the box, `lower` in Band's foot area or,
 * for every other layout, after the upper rows in the same box.
 */
export function place(a: Areas, upper: Row[], lower: Row[], minGap: number) {
  const [first, ...rest] = upper;
  const head = a.topMinH ? { h: Math.max(first.h, a.topMinH), draw: first.draw } : first;
  if (!a.foot) return spread(a.box, [head, ...rest, ...lower], minGap);
  spread(a.box, [head, ...rest], minGap);
  if (lower.length === 1) lower[0].draw(a.foot.y + a.foot.h - lower[0].h);
  else spread(a.foot, lower, minGap);
}

/** Height the top row takes once Corner's tile is counted. */
export const topHeight = (a: Areas, h: number) => Math.max(h, a.topMinH);

export interface Fit {
  size: number;
  lh: number;
  lines: string[];
}

/** Wraps `text` at `start` px, shrinking in steps until it fits `maxH` or reaches `min`. */
export function fitLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  maxH: number,
  start: number,
  o: { weight: number; family: string; spacing: number; lh: number; min: number; indent?: number },
): Fit {
  let size = start;
  for (;;) {
    setFont(ctx, o.weight, size, o.family, o.spacing);
    const lines = wrap(ctx, text, maxW + (o.indent ?? 0) * size);
    if (lines.length * size * o.lh <= maxH || size <= o.min)
      return { size, lh: size * o.lh, lines };
    size = Math.max(o.min, size * 0.92);
  }
}
