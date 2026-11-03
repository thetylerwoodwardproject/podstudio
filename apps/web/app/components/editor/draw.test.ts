import { describe, expect, it } from "vitest";
import type { Clip, Track } from "~/lib/project/document";
import { PEAK_SPP, rangePeak, type Peaks } from "~/lib/project/peaks";
import { drawTrack } from "./draw";

// A canvas stand-in that records the waveform bars (the ones drawn in the track color).
function fakeCtx() {
  const cols: { x: number; y: number; h: number }[] = [];
  const ctx: any = {
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    lineWidth: 1,
    clearRect() {},
    strokeRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fill() {},
    arc() {},
    closePath() {},
    save() {},
    restore() {},
    fillRect() {},
    // clips draw audiocn's waveform bars (rounded rects) in the track colour
    roundRect(x: number, y: number, _w: number, h: number) {
      if (ctx.fillStyle === "WAVE") cols.push({ x, y, h });
    },
  };
  return { ctx: ctx as CanvasRenderingContext2D, cols };
}

// deterministic, bumpy "speech": a different min/max in every 256-sample block
const BLOCKS = 4000;
const peaks: Peaks = { spp: PEAK_SPP, data: Float32Array.from({ length: BLOCKS * 2 }, (_, i) => (i % 2 ? 1 : -1) * (0.1 + 0.8 * Math.abs(Math.sin(Math.floor(i / 2) * 0.37)))) };
const track: Track = { id: "t", name: "Host", kind: "host", muted: false, solo: false, locked: false, height: 96 };
const css = (n: string) => (n === "--speaker-host" ? "WAVE" : "#222");
const clip = (start: number): Clip => ({ id: "c", trackId: "t", sourceId: "s", srcStart: 5000, length: 400_000, start, gainDb: 0, fadeIn: 0, fadeOut: 0 });

function render(start: number, originPx: number, spp: number) {
  const { ctx, cols } = fakeCtx();
  drawTrack({ ctx, width: 1200, height: 96, spp, originPx, clips: [clip(start)], track, peaks: { s: peaks }, selectedClipId: null, range: null, dim: false, css });
  return cols;
}
/** Column shapes keyed by clip-local column index. */
const byLocal = (cols: { x: number; y: number; h: number }[], x0: number) => new Map(cols.map((c) => [c.x - x0, `${c.y}/${c.h}`]));

describe("waveform drawing is anchored to the clip", () => {
  it("a clip dragged by fractions of a pixel keeps exactly the same column shapes (no swimming)", () => {
    const spp = 150;
    const base = byLocal(render(300 * spp, 0, spp), 300);
    for (const frac of [0.13, 0.37, 0.49, 0.5, 0.74, 0.99]) {
      const start = Math.round((300 + frac) * spp);
      const x0 = Math.round(start / spp);
      const moved = byLocal(render(start, 0, spp), x0);
      let diff = 0;
      for (const [j, shape] of base) if (j < 890 && moved.get(j) !== shape) diff++; // ignore the columns cut off by the canvas edge
      expect(diff).toBe(0);
    }
  });
  it("scrolling to another tile origin (any whole pixel) draws identical columns for the same clip", () => {
    const spp = 150;
    const a = byLocal(render(300 * spp, 0, spp), 300);
    for (const origin of [1, 7, 50, 123]) {
      const b = byLocal(render(300 * spp, origin, spp), 300 - origin);
      for (const [j, shape] of a) if (j + 0 >= 0 && b.has(j)) expect(b.get(j)).toBe(shape);
    }
  });
  it("covers the whole clip width on audiocn's bar grid (2 px bar + 1 px gap): no gaps or doubled bars", () => {
    const spp = 150;
    const cols = render(10 * spp, 0, spp);
    const xs = cols.map((c) => c.x).sort((a, b) => a - b);
    expect(xs.length).toBeGreaterThan(300);
    expect(new Set(xs).size).toBe(xs.length);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBe(3);
    expect(xs[0]).toBe(10);
  });
  it("(why the old drawing swam) buckets cut from the viewport origin change shape at fractional offsets", () => {
    // the previous algorithm: bucket boundaries = originSample + px*spp, relative to a fractional clip start
    const spp = 150;
    const old = (start: number, origin: number) => {
      const out = new Map<number, string>();
      for (let px = 0; px < 600; px++) {
        const tA = origin + px * spp;
        const s0 = 5000 + Math.max(0, tA - start);
        const s1 = 5000 + Math.min(400_000, tA + spp - start);
        const [lo, hi] = rangePeak(peaks, s0, s1);
        out.set(Math.round(tA / spp), `${lo.toFixed(3)}/${hi.toFixed(3)}`);
      }
      return out;
    };
    const a = old(300 * spp, 0);
    const b = old(Math.round(300.4 * spp), 0); // dragged 0.4 px
    let diff = 0;
    for (let px = 320; px < 520; px++) if (a.get(px) !== b.get(px + 0)) diff++;
    expect(diff).toBeGreaterThan(20); // the old way visibly re-slices the audio while the clip moves
  });
});
