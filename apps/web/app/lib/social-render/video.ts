// Ported from the TWP social generator (tylerwoodward.me, src/lib/social/) so Podstudio's social
// previews are the same drawing. Changes from the original are limited to the `brand` hooks below
// (wordmark, domain, bar color, quote credit), so another show can use it.
// Canvas renderer for the 9:16 reel. Same palette, fonts and percent-of-width scale as the posts
// (render.ts), so a reel frame sits next to the Instagram post without looking foreign.
import {
  GROUND,
  INK,
  MONO,
  MUTED,
  SANS,
  brand,
  TRACK,
  clip,
  footer,
  formats,
  line,
  lineBox,
  setFont,
  type Row,
  type Scene,
} from './render';
import { BAR_COUNT } from './audio';
import { fitLines, paintImagery, place, topHeight, type Layout } from './layout';

export const REEL_W = 1080;
export const REEL_H = 1920;

export interface ReelFrame {
  headline: string;
  meta: string;
  wordmark: 'Stacked' | 'Domain' | 'Logo';
  /** Bar heights for this frame, 0 to 1; empty draws the bars at rest. */
  bars: ArrayLike<number>;
  progress: boolean;
  /** Seconds into the clip, and the clip length. */
  t: number;
  length: number;
  background: CanvasImageSource | null;
  /** Where the background goes (layout.ts). */
  layout: Layout;
  /** 0 to 1: how much ground colour sits over full-frame imagery. */
  dim: number;
}

const f = formats[0];

export const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function drawReel(canvas: HTMLCanvasElement | OffscreenCanvas, r: ReelFrame) {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) return;
  const W = REEL_W,
    H = REEL_H,
    u = W / 100;
  canvas.width = W;
  canvas.height = H;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, W, H);

  // Reels and Shorts cover the top and bottom of the frame with their own controls: imagery may
  // sit under them, type may not.
  const p = f.pad * u;
  const a = paintImagery(ctx, W, H, r.layout, r.background, {
    pad: p,
    dim: r.dim,
    artH: 0.4,
    safeTop: 17 * u,
    safeBottom: 27 * u,
  });
  const box = a.box;

  setFont(ctx, 400, f.meta * u, MONO);
  const topH = lineBox(ctx);
  const top: Row = {
    h: topH,
    draw: (y) => {
      setFont(ctx, 400, f.meta * u, MONO);
      ctx.fillStyle = MUTED;
      const time = r.progress ? `${clock(r.t)} / ${clock(r.length)}` : '';
      const width = box.w - a.topInset;
      const room = width - (time ? ctx.measureText(time).width + 2 * u : 0);
      line(ctx, clip(ctx, r.meta, room), box.x, y, topH);
      if (time) line(ctx, time, box.x + width - ctx.measureText(time).width, y, topH);
    },
  };

  const scene = { wordmark: r.wordmark, waveform: false } as Scene;
  const mark = footer(ctx, f, scene, box);
  const barH = 0.5 * u;
  const bottom: Row = {
    h: mark.h + (r.progress ? 4 * u + barH : 0),
    draw: (y) => {
      if (r.progress) {
        ctx.fillStyle = TRACK;
        ctx.fillRect(box.x, y, box.w, barH);
        ctx.fillStyle = INK;
        ctx.fillRect(box.x, y, box.w * Math.min(1, r.t / Math.max(0.001, r.length)), barH);
      }
      mark.draw(y + (r.progress ? 4 * u + barH : 0));
    },
  };

  // The waveform gives way first (down to 12u), then the headline shrinks, so the layouts that
  // take part of the frame for imagery still fit between the safe zones.
  const gap = 3 * u,
    waveMax = 20 * u,
    waveMin = 12 * u;
  const topUsed = topHeight(a, topH) + gap;
  const headRoom = a.foot ? box.h - topUsed : box.h - topUsed - waveMin - gap - bottom.h - gap;
  const fit = fitLines(ctx, r.headline, box.w, headRoom, 9 * u, {
    weight: 500,
    family: SANS,
    spacing: -0.025,
    lh: 1.08,
    min: 5 * u,
  });
  const head: Row = {
    h: fit.lines.length * fit.lh,
    draw: (y) => {
      setFont(ctx, 500, fit.size, SANS, -0.025);
      ctx.fillStyle = INK;
      fit.lines.forEach((t, i) => line(ctx, t, box.x, y + i * fit.lh, fit.lh));
    },
  };

  const waveRoom = a.foot
    ? a.foot.h - bottom.h - gap
    : box.h - topUsed - head.h - gap - bottom.h - gap;
  const waveH = Math.min(waveMax, Math.max(waveMin, waveRoom));
  const wave: Row = {
    h: waveH,
    draw: (y) => {
      const gap = 0.6 * u;
      const bw = (box.w - gap * (BAR_COUNT - 1)) / BAR_COUNT;
      ctx.fillStyle = brand.signal;
      for (let i = 0; i < BAR_COUNT; i++) {
        const bh = Math.max(bw, (r.bars[i] ?? 0.06) * waveH);
        ctx.beginPath();
        ctx.roundRect(box.x + i * (bw + gap), y + (waveH - bh) / 2, bw, bh, bw / 2);
        ctx.fill();
      }
    },
  };

  place(a, [top, head], [wave, bottom], gap);
}
