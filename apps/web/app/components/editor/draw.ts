import { clipEnd, type Clip, type ProjectDoc, type Track } from "~/lib/project/document";
import { rangePeak, type Peaks } from "~/lib/project/peaks";

export const TRACK_COLORS: Record<Track["kind"], string> = {
  host: "--speaker-host",
  guest: "--speaker-guest",
  music: "--speaker-music",
  sfx: "--muted-foreground",
};

/** A track's colour as a CSS value: its custom colour, or the variable for its kind. */
export const trackColor = (t: Pick<Track, "kind" | "color">) => t.color ?? `var(${TRACK_COLORS[t.kind]})`;

export interface DrawArgs {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** Timeline samples per CSS pixel. */
  spp: number;
  /** Content-space pixel (timeline sample / spp) at the canvas' left edge. Always an integer. */
  originPx: number;
  /** The clips on this track. */
  clips: Clip[];
  track: Track;
  peaks: Record<string, Peaks | undefined>;
  selectedClipId: string | null;
  range: { from: number; to: number } | null;
  dim: boolean;
  css: (name: string) => string;
  /** Name shown on each clip, by source id (the source's label). */
  labels?: Record<string, string>;
}

/** Height of the name strip on top of each clip (none on short tracks). */
export const labelHeight = (trackHeight: number) => (trackHeight >= 72 ? 15 : 0);

export function drawTrack(a: DrawArgs) {
  const { ctx, width, height, spp, originPx } = a;
  ctx.clearRect(0, 0, width, height);
  // Everything is snapped to whole content pixels, and the waveform is bucketed on a grid that
  // starts at the clip's own first pixel — so moving a clip just shifts identical columns instead
  // of re-slicing the audio differently at every sub-pixel offset (that made the lines swim).
  const px = (t: number) => Math.round(t / spp) - originPx;
  const color = a.track.color ?? a.css(TRACK_COLORS[a.track.kind]);
  const lh = labelHeight(height);
  // the waveform lives below the name strip
  const mid = lh + (height - lh) / 2;
  const half = (height - lh) / 2 - 4;

  // drawn in start order, so in a crossfade the later clip is on top (and is what a click picks)
  const ordered = [...a.clips].sort((x, y) => x.start - y.start);
  for (const c of ordered) {
    const x0 = px(c.start);
    const x1 = Math.max(x0 + 1, px(clipEnd(c)));
    if (x1 < 0 || x0 > width) continue;
    const cx0 = Math.max(0, x0);
    const cx1 = Math.min(width, x1);
    const selected = c.id === a.selectedClipId;
    ctx.globalAlpha = a.dim ? 0.45 : 1;
    // body: tinted with the track colour (stronger when selected), name strip on top
    ctx.fillStyle = a.css("--card");
    ctx.fillRect(cx0, 1, cx1 - cx0, height - 2);
    ctx.globalAlpha = (a.dim ? 0.45 : 1) * (selected ? 0.34 : 0.2);
    ctx.fillStyle = color;
    ctx.fillRect(cx0, 1, cx1 - cx0, height - 2);
    if (lh) {
      ctx.globalAlpha = (a.dim ? 0.45 : 1) * (selected ? 0.75 : 0.5);
      ctx.fillRect(cx0, 1, cx1 - cx0, lh);
      const label = a.labels?.[c.sourceId];
      if (label && x1 - x0 > 28) {
        ctx.globalAlpha = a.dim ? 0.5 : 0.95;
        ctx.fillStyle = a.css("--foreground");
        ctx.font = "500 10.5px ui-sans-serif, system-ui, sans-serif";
        ctx.textBaseline = "middle";
        ctx.save();
        ctx.beginPath();
        ctx.rect(Math.max(x0, 0) + 1, 1, Math.min(x1, width) - Math.max(x0, 0) - 6, lh);
        ctx.clip();
        ctx.fillText(label, Math.max(x0, 0) + 5, 1 + lh / 2 + 0.5);
        ctx.restore();
      }
    }
    ctx.globalAlpha = a.dim ? 0.45 : 1;
    // waveform: column j covers source samples [srcStart + j*spp, srcStart + (j+1)*spp)
    const p = a.peaks[c.sourceId];
    ctx.fillStyle = color;
    if (p) {
      for (let col = cx0; col < cx1; col++) {
        const j = col - x0;
        const s0 = c.srcStart + j * spp;
        const s1 = Math.min(c.srcStart + c.length, s0 + spp);
        if (s1 <= s0) continue;
        const [lo, hi] = rangePeak(p, s0, s1);
        const y0 = Math.round(mid - hi * half);
        const y1 = Math.round(mid - lo * half);
        ctx.fillRect(col, y0, 1, Math.max(1, y1 - y0));
      }
    } else {
      ctx.fillRect(cx0, Math.round(mid), cx1 - cx0, 1);
    }
    // fades
    ctx.strokeStyle = a.css("--foreground");
    ctx.globalAlpha = a.dim ? 0.25 : 0.6;
    ctx.lineWidth = 1;
    const xf = px(c.start + c.fadeIn);
    const xo = px(clipEnd(c) - c.fadeOut);
    // the faded-down part is shaded so a fade reads at a glance
    ctx.save();
    ctx.globalAlpha = a.dim ? 0.3 : 0.5;
    ctx.fillStyle = a.css("--background");
    if (c.fadeIn > 0) {
      ctx.beginPath();
      ctx.moveTo(x0, 3);
      ctx.lineTo(xf, 3);
      ctx.lineTo(x0, height - 3);
      ctx.closePath();
      ctx.fill();
    }
    if (c.fadeOut > 0) {
      ctx.beginPath();
      ctx.moveTo(xo, 3);
      ctx.lineTo(x1, 3);
      ctx.lineTo(x1, height - 3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    if (c.fadeIn > 0) fadeLine(ctx, x0, xf, height, false);
    if (c.fadeOut > 0) fadeLine(ctx, xo, x1, height, true);
    // fade handles in the top corners: little dots where the fade ends (bigger when the clip is selected)
    ctx.fillStyle = a.css("--foreground");
    const hr = selected ? 4 : 2.5;
    for (const hx of [xf, xo]) {
      if (hx < -8 || hx > width + 8) continue;
      ctx.beginPath();
      ctx.arc(hx, lh ? lh + 5 : 6, hr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = a.dim ? 0.45 : 1;
    // outline
    ctx.strokeStyle = selected ? a.css("--ring") : a.css("--border");
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeRect(x0 + 0.5, 1.5, x1 - x0 - 1, height - 3);
    ctx.globalAlpha = 1;
  }

  // crossfades: where two clips overlap, a band with an X (one fading out, one fading in)
  const sorted = ordered;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.start >= clipEnd(prev)) continue;
    const x0 = px(cur.start);
    const x1 = px(clipEnd(prev));
    if (x1 < 0 || x0 > width) continue;
    ctx.globalAlpha = a.dim ? 0.3 : 0.55;
    ctx.fillStyle = a.css("--background");
    ctx.fillRect(x0, 1, Math.max(1, x1 - x0), height - 2);
    ctx.globalAlpha = a.dim ? 0.45 : 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, 3);
    ctx.lineTo(x1, height - 3);
    ctx.moveTo(x0, height - 3);
    ctx.lineTo(x1, 3);
    ctx.stroke();
    ctx.strokeStyle = a.css("--foreground");
    ctx.globalAlpha = 0.35;
    ctx.strokeRect(x0 + 0.5, 1.5, Math.max(1, x1 - x0) - 1, height - 3);
    ctx.globalAlpha = 1;
  }

  if (a.range) {
    const r0 = Math.max(0, px(a.range.from));
    const r1 = Math.min(width, px(a.range.to));
    if (r1 > r0) {
      ctx.fillStyle = a.css("--ring");
      ctx.globalAlpha = 0.22;
      ctx.fillRect(r0, 0, r1 - r0, height);
      ctx.globalAlpha = 0.9;
      const e0 = px(a.range.from);
      const e1 = px(a.range.to);
      if (e0 >= 0 && e0 <= width) ctx.fillRect(e0, 0, 1, height);
      if (e1 >= 0 && e1 <= width) ctx.fillRect(e1 - 1, 0, 1, height);
      ctx.globalAlpha = 1;
    }
  }
}

function fadeLine(ctx: CanvasRenderingContext2D, xa: number, xb: number, h: number, out: boolean) {
  ctx.beginPath();
  ctx.moveTo(xa, out ? 3 : h - 3);
  ctx.lineTo(xb, out ? h - 3 : 3);
  ctx.stroke();
}

/** Nice ruler step (seconds) for a given pixel density. */
export function rulerStep(spp: number, rate: number): number {
  const pxPerS = rate / spp;
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  return steps.find((s) => s * pxPerS >= 70) ?? 3600;
}

export function clockText(s: number, decimals = 0): string {
  const neg = s < 0;
  s = Math.abs(s);
  const t = Math.floor(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  const frac = decimals ? "." + String(Math.floor((s - t) * 10 ** decimals)).padStart(decimals, "0") : "";
  return `${neg ? "−" : ""}${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${sec}${frac}`;
}

/** The clip under timeline sample `t` on a track; inside a crossfade, the later (top) one. */
export const clipAt = (doc: ProjectDoc, trackId: string, t: number): Clip | undefined => {
  let hit: Clip | undefined;
  for (const c of doc.clips) if (c.trackId === trackId && t >= c.start && t < clipEnd(c) && (!hit || c.start > hit.start)) hit = c;
  return hit;
};
