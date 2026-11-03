import { useEffect, useMemo, useRef } from "react";
import { LiveWaveform as AudiocnLiveWaveform } from "~/components/ui/live-waveform";
import { createFrameEmitter } from "~/lib/audio/frame-source";
import type { VisualFrame } from "~/lib/audio/types";

const EMPTY = new Float32Array(0);
/** Slots per second in the session's peak ring (one per 50 ms meter update). */
const SLOTS_PER_S = 20;

/**
 * Live waveform of the recording: the audiocn LiveWaveform (scrolling level history, newest on the
 * right moving left; "bars" draws each bar up and down from the midline — audiocn's "mirror" variant
 * would mirror the history left/right out of the center)
 * fed from the session's ring of peak levels, newest on the right, plus a red tally line at every
 * retake (K) press.
 */
export function LiveWaveform({ peaks, head, active, marks }: { peaks: Float32Array; head: () => number; active: boolean; marks: { ageSlots: () => number[] } }) {
  const frames = useMemo(() => createFrameEmitter<VisualFrame>(), []);
  const overlay = useRef<HTMLCanvasElement>(null);
  const BAR = 2; // px per slot (bar width + gap): the last ~N s fit the width

  useEffect(() => {
    const n = peaks.length;
    // the ring in time order, eased so quiet speech shows (same curve as before)
    const view = new Float32Array(n);
    let raf = 0;
    const tick = () => {
      const start = head() % n;
      let pk = 0;
      for (let i = 0; i < n; i++) {
        const v = peaks[(start + i) % n]!;
        view[i] = v > 0 ? Math.pow(v, 0.6) : 0;
        if (v > pk) pk = v;
      }
      frames.emit({ bands: EMPTY, history: view, historyStart: 0, historyLength: n, historyUpdatedAt: performance.now(), historyIntervalMs: 0, peakDb: pk > 0 ? 20 * Math.log10(pk) : -Infinity });
      // retake tallies over the waveform
      const c = overlay.current;
      if (c) {
        const dpr = window.devicePixelRatio || 1;
        const w = c.clientWidth;
        const h = c.clientHeight;
        if (c.width !== Math.round(w * dpr)) {
          c.width = Math.round(w * dpr);
          c.height = Math.round(h * dpr);
        }
        const ctx = c.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = getComputedStyle(c).getPropertyValue("--destructive").trim() || "#e5484d";
        for (const age of marks.ageSlots()) {
          const x = w - age * BAR - 1;
          if (age >= 0 && x >= 0) ctx.fillRect(x, 0, 2, h);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [peaks, head, marks, frames]);

  return (
    <div className="relative h-full w-full text-host" role="img" aria-label={`Live waveform, last ${Math.round(peaks.length / SLOTS_PER_S)} seconds`}>
      <AudiocnLiveWaveform source={frames} mode="scrolling" variant="bars" barWidth={BAR - 1} barGap={1} barRadius={0.5} minBarHeight={1} active={active} className="h-full w-full" />
      <canvas ref={overlay} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
    </div>
  );
}
