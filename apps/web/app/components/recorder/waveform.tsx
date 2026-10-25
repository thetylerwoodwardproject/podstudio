import { useEffect, useRef } from "react";

// Live waveform of the last 60 s: one vertical bar per 50 ms meter update, newest on
// the right, drawn from the session's ring of peak levels. Host amber (--speaker-host).
export function LiveWaveform({ peaks, head, active, marks }: { peaks: Float32Array; head: () => number; active: boolean; marks: { ageSlots: () => number[] } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    const css = getComputedStyle(canvas);
    const host = css.getPropertyValue("--speaker-host").trim() || "#e8b04a";
    const line = css.getPropertyValue("--border").trim() || "#26262b";
    const tally = css.getPropertyValue("--destructive").trim() || "#e5484d";
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = line;
      ctx.fillRect(0, h / 2, w, 1);
      const n = peaks.length;
      const barW = w / n;
      const start = head();
      ctx.fillStyle = host;
      ctx.globalAlpha = active ? 1 : 0.35;
      for (let i = 0; i < n; i++) {
        const v = peaks[(start + i) % n]!;
        if (v <= 0) continue;
        // a gentle curve so quiet speech is visible without clipping reading as flat
        const bar = Math.max(1, Math.pow(v, 0.6) * (h - 6));
        ctx.fillRect(i * barW, (h - bar) / 2, Math.max(1, barW - 0.5), bar);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = tally;
      for (const age of marks.ageSlots()) if (age >= 0 && age < n) ctx.fillRect(w - age * barW - 1, 0, 2, h);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [peaks, head, active, marks]);
  return <canvas ref={ref} className="h-full w-full" aria-label="Live waveform, last 60 seconds" role="img" />;
}
