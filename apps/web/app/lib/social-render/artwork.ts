// Ported from the TWP social generator (tylerwoodward.me, src/lib/social/) so Podstudio's social
// previews are the same drawing. Changes from the original are limited to the `brand` hooks below
// (wordmark, domain, bar color, quote credit), so another show can use it.
// Canvas renderer for the Artwork tab: a square podcast cover and a YouTube thumbnail. Same
// brand pieces as the posts (ground, Archivo headline, mono wordmark, the one lime waveform),
// with the title sized to fit so a long one shrinks instead of running off the edge.
import {
  GROUND,
  INK,
  MONO,
  SANS,
  SOFT,
  clip,
  cover,
  footer,
  line,
  lineBox,
  setFont,
  spread,
  wrap,
  type FooterFormat,
  type Row,
} from './render';

export interface ArtFormat extends FooterFormat {
  id: string;
  name: string;
  h: number;
  /** Sizes are percentages of the width, as in render.ts. */
  pad: number;
  kicker: number;
  /** Largest and smallest title size; it shrinks between them to fit. */
  head: number;
  minHead: number;
  /** Most title lines before it shrinks instead. */
  lines: number;
  /** Largest file the destination accepts; over it, the export falls back to JPEG. */
  maxBytes?: number;
}

export const artFormats: ArtFormat[] = [
  {
    id: 'cover',
    name: 'Podcast cover',
    w: 3000,
    h: 3000,
    pad: 8,
    kicker: 3.6,
    head: 12,
    minHead: 6,
    lines: 4,
    mark: 4.2,
    domain: 4.4,
    waveH: 10.5,
    waveW: 1.6,
    waveGap: 1.15,
  },
  {
    id: 'youtube',
    name: 'YouTube thumbnail',
    w: 1280,
    h: 720,
    pad: 5.5,
    kicker: 2.6,
    head: 8.4,
    minHead: 4.5,
    lines: 3,
    mark: 2.5,
    domain: 2.7,
    waveH: 6.4,
    waveW: 0.95,
    waveGap: 0.7,
    maxBytes: 2 * 1024 * 1024,
  },
];

export interface ArtScene {
  title: string;
  /** Small mono line above the title, such as "Ep 42". Empty leaves it out. */
  kicker: string;
  wordmark: 'Stacked' | 'Domain';
  waveform: boolean;
  /** Full-bleed image behind the type; null is solid ground. */
  backdrop: CanvasImageSource | null;
  /** 0 to 1: how much ground colour sits over the backdrop. */
  dim: number;
}

export function drawArtwork(canvas: HTMLCanvasElement, f: ArtFormat, s: ArtScene) {
  // Opaque, so the PNG comes out RGB with no alpha channel, as Apple Podcasts asks. The first
  // getContext call fixes this for the canvas's life, so nothing else may get a context first.
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  const W = f.w,
    H = f.h,
    u = W / 100;
  canvas.width = W;
  canvas.height = H;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, W, H);

  if (s.backdrop) {
    cover(ctx, s.backdrop, 0, 0, W, H);
    ctx.globalAlpha = s.dim;
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  const p = f.pad * u;
  const box = { x: p, y: p, w: W - p * 2, h: H - p * 2 };
  const gap = 3 * u;

  const kicker = s.kicker.trim();
  setFont(ctx, 400, f.kicker * u, MONO);
  const klh = kicker ? lineBox(ctx) : 0;
  const top: Row = {
    h: klh,
    draw: (y) => {
      if (!kicker) return;
      setFont(ctx, 400, f.kicker * u, MONO);
      ctx.fillStyle = SOFT;
      line(ctx, clip(ctx, kicker, box.w), box.x, y, klh);
    },
  };

  const bottom = footer(ctx, f, s, box);

  // Largest size where the title fits the line cap, the width and the room left over.
  const room = box.h - klh - bottom.h - gap * 2;
  let size = f.head * u;
  let lines: string[] = [];
  for (;;) {
    setFont(ctx, 500, size, SANS, -0.025);
    lines = wrap(ctx, s.title, box.w);
    const widest = Math.max(0, ...lines.map((t) => ctx.measureText(t).width));
    const fits = lines.length <= f.lines && widest <= box.w && lines.length * size * 1.04 <= room;
    if (fits || size <= f.minHead * u) break;
    size *= 0.96;
  }
  const lh = size * 1.04;
  const title: Row = {
    h: lines.length * lh,
    draw: (y) => {
      setFont(ctx, 500, size, SANS, -0.025);
      ctx.fillStyle = INK;
      lines.forEach((t, i) => line(ctx, t, box.x, y + i * lh, lh));
    },
  };

  spread(box, [top, title, bottom], gap);
}

/** PNG, unless the format has a size cap the PNG breaks; then the best JPEG under it. */
export async function artworkBlob(canvas: HTMLCanvasElement, f: ArtFormat) {
  const as = (type: string, q?: number) =>
    new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
  const png = await as('image/png');
  if (!png || !f.maxBytes || png.size <= f.maxBytes) return { blob: png, ext: 'png' };
  for (const q of [0.92, 0.85, 0.75]) {
    const jpg = await as('image/jpeg', q);
    if (jpg && jpg.size <= f.maxBytes) return { blob: jpg, ext: 'jpg' };
  }
  return { blob: await as('image/jpeg', 0.6), ext: 'jpg' };
}
