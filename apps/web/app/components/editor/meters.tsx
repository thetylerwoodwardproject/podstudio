import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PODCAST_LOUDNESS } from "@podstudio/audio/loudness";
import { LevelMeter, LevelMeterBar, LevelMeterChannel, LevelMeterChannels, LevelMeterClip, LevelMeterHold, LevelMeterScale, LevelMeterTrack, LevelMeterValue } from "~/components/ui/level-meter";
import { createFrameEmitter, type FrameEmitter } from "~/lib/audio/frame-source";
import type { MeterFrame, MeterZone } from "~/lib/audio/types";
import type { EditorPlayer } from "~/lib/project/player";
import { cn } from "~/lib/utils";

const toDb = (lin: number) => (lin > 0 ? 20 * Math.log10(lin) : Number.NEGATIVE_INFINITY);
const SILENT: MeterFrame = { channels: [{ peakDb: Number.NEGATIVE_INFINITY, rmsDb: Number.NEGATIVE_INFINITY }] };
const SILENT_LR: MeterFrame = { channels: [SILENT.channels[0]!, SILENT.channels[0]!] };

/** Loudness bars: green up to the target, amber just over it, red well over. */
const lufsZones = (target: number): MeterZone[] => [
  { fromDb: Number.NEGATIVE_INFINITY, zone: "ok" },
  { fromDb: target + 1, zone: "warn" },
  { fromDb: target + 5, zone: "clip" },
];

export interface LoudnessReadout {
  momentary: number;
  shortTerm: number;
  integrated: number;
  truePeak: number;
  lra: number;
}

/**
 * Feeds the meters from the player: per-track peak/RMS (from each track's analyser, every frame)
 * and the master mix (every 4096-sample block from the master tap: peak/RMS, BS.1770 loudness and
 * true peak). Integrated loudness, LRA and the true-peak max run until `reset()`.
 */
export function useMeters(player: React.RefObject<EditorPlayer | null>, rate: number, trackIds: string[], playing: boolean, layout: "mono" | "stereo" = "stereo") {
  const tracks = useRef(new Map<string, FrameEmitter<MeterFrame>>());
  const trackSource = useCallback((id: string) => {
    let e = tracks.current.get(id);
    if (!e) {
      e = createFrameEmitter<MeterFrame>();
      tracks.current.set(id, e);
    }
    return e;
  }, []);
  const master = useMemo(() => createFrameEmitter<MeterFrame>(), []);
  const loud = useMemo(() => createFrameEmitter<MeterFrame>(), []);
  const empty: LoudnessReadout = { momentary: -Infinity, shortTerm: -Infinity, integrated: -Infinity, truePeak: -Infinity, lra: 0 };
  const [readout, setReadout] = useState<LoudnessReadout>(empty);
  const readoutRef = useRef<LoudnessReadout>(empty);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const reset = useCallback(() => {
    player.current?.resetLoudness();
    const cleared = { momentary: -Infinity, shortTerm: -Infinity, integrated: -Infinity, truePeak: -Infinity, lra: 0 };
    readoutRef.current = cleared;
    setReadout(cleared);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, rate]);

  // master: the meter worklet's reports (L/R levels; loudness of the stereo mix and of its mono fold-down)
  useEffect(() => {
    const pl = player.current;
    if (!pl) return;
    pl.onMeter = (r) => {
      master.emit({ channels: [{ peakDb: toDb(r.peak[0]), rmsDb: toDb(r.rms[0]) }, { peakDb: toDb(r.peak[1]), rmsDb: toDb(r.rms[1]) }] });
      const L = layoutRef.current === "mono" ? r.mono : r.stereo;
      // computed here, not inside a state updater: emitting runs the meters' effect events, which must not happen during render
      const cur = readoutRef.current;
      const next = { momentary: L.m, shortTerm: L.s, integrated: L.i ?? cur.integrated, truePeak: L.tp, lra: L.lra ?? cur.lra };
      readoutRef.current = next;
      setReadout(next);
      loud.emit({ channels: [{ peakDb: next.momentary }, { peakDb: next.shortTerm }, { peakDb: next.integrated }] });
    };
    return () => {
      if (pl.onMeter) pl.onMeter = null;
    };
  }, [player, master, loud]);

  // tracks: analyser levels every frame while playing; one silent frame when it stops
  const ids = trackIds.join("|");
  useEffect(() => {
    const list = ids ? ids.split("|") : [];
    if (!playing) {
      for (const id of list) trackSource(id).emit(SILENT_LR);
      master.emit(SILENT_LR);
      return;
    }
    let raf = 0;
    const tick = () => {
      const pl = player.current;
      if (pl) {
        for (const id of list) {
          const { peak, rms, peakR, rmsR } = pl.trackLevel(id);
          trackSource(id).emit({ channels: [{ peakDb: toDb(peak), rmsDb: toDb(rms) }, { peakDb: toDb(peakR), rmsDb: toDb(rmsR) }] });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, ids, player, trackSource, master]);

  return { trackSource, master, loud, readout, reset };
}

// All meters are audiocn's LevelMeter in its stock look: solid bars in the default zones (green,
// amber from −20 dBFS, red from −9 dBFS), a peak hold, the dB scale under/beside the bars, a dB
// readout and a clip light. LUFS uses the same parts on a loudness range with the target marked.

const LUFS_TOP = -6;
const LUFS_BOTTOM = -42;

/** A track's level in its header: L/R bars for a stereo or panned track, one bar for centred mono. */
export function TrackMeter({ source, dim, stereo }: { source: FrameEmitter<MeterFrame>; dim?: boolean; stereo?: boolean }) {
  return (
    <LevelMeter source={source} size="sm" className={cn("w-full", dim && "opacity-40")} aria-label={stereo ? "Track level, left and right" : "Track level"} data-testid="track-meter" data-stereo={stereo ? "" : undefined}>
      <LevelMeterChannels>
        {(stereo ? [0, 1] : [0]).map((i) => (
          <LevelMeterChannel key={i} index={i}>
            <LevelMeterTrack>
              <LevelMeterBar />
              <LevelMeterHold />
            </LevelMeterTrack>
          </LevelMeterChannel>
        ))}
      </LevelMeterChannels>
    </LevelMeter>
  );
}

const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d).replace("-", "−") : "−∞");

/** The master meter: horizontal, in the transport bar. Click the meter to switch dBFS ⇄ LUFS. */
export function TransportMeter({ master, loud, readout, mode, onMode, layout = "stereo" }: { master: FrameEmitter<MeterFrame>; loud: FrameEmitter<MeterFrame>; readout: LoudnessReadout; mode: "dbfs" | "lufs"; onMode: (m: "dbfs" | "lufs") => void; layout?: "mono" | "stereo" }) {
  const target = layout === "mono" ? PODCAST_LOUDNESS.mono : PODCAST_LOUDNESS.stereo;
  const zones = useMemo(() => lufsZones(target), [target]);
  const flip = () => onMode(mode === "dbfs" ? "lufs" : "dbfs");
  return (
    <div className="grid h-12 w-[340px] grid-cols-[44px_minmax(0,1fr)] items-center gap-2 rounded-md border border-border bg-background/60 px-2 hover:border-ring/50" data-testid="transport-meter" data-mode={mode}>
      <button type="button" onClick={flip} title={mode === "dbfs" ? "Master level (dBFS) — click for loudness (LUFS)" : "Master loudness: momentary / short-term / integrated — click for levels (dBFS)"} className="rounded text-center text-[9.5px] font-semibold uppercase leading-tight tracking-[0.06em] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50" data-testid="transport-meter-mode">
        {mode === "dbfs" ? "dBFS" : "LUFS"}
      </button>
      <div className="min-w-0 cursor-pointer" onClick={flip} data-testid="transport-meter-block">
        {mode === "dbfs" ? (
          <LevelMeter source={master} size="sm" className="w-full items-center" aria-label="Master level, dBFS, left and right">
            <LevelMeterChannels>
              {[0, 1].map((i) => (
                <LevelMeterChannel key={i} index={i}>
                  <LevelMeterTrack data-testid={`transport-${i ? "right" : "left"}`}>
                    <LevelMeterBar />
                    <LevelMeterHold />
                  </LevelMeterTrack>
                </LevelMeterChannel>
              ))}
              <LevelMeterScale ticks={[0, -6, -12, -18, -24, -36, -48, -60]} />
            </LevelMeterChannels>
            <LevelMeterValue className="text-[11px]" data-testid="transport-meter-value" />
            <span onClick={(e) => e.stopPropagation()}><LevelMeterClip /></span>
          </LevelMeter>
        ) : (
          <LevelMeter source={loud} channelCount={3} ballistics="instant" size="sm" minDb={LUFS_BOTTOM} maxDb={LUFS_TOP} zones={zones} className="w-full items-center" aria-label="Loudness, LUFS: momentary, short-term, integrated">
            <LevelMeterChannels className="relative">
              {[0, 1, 2].map((i) => (
                <LevelMeterChannel key={i} index={i}>
                  <LevelMeterTrack>
                    <LevelMeterBar />
                  </LevelMeterTrack>
                </LevelMeterChannel>
              ))}
              <LevelMeterScale ticks={[-6, -12, -16, -19, -23, -30, -42]} />
              <div className="pointer-events-none absolute top-[-2px] h-[calc(3*var(--meter-thickness)+2*var(--meter-gap)+4px)] w-0.5 rounded bg-foreground" style={{ left: `${((target - LUFS_BOTTOM) / (LUFS_TOP - LUFS_BOTTOM)) * 100}%` }} title={`Target ${target} LUFS`} data-testid="lufs-target" />
            </LevelMeterChannels>
            <span className={cn("min-w-[44px] text-right font-mono text-[11px] tabular-nums", Number.isFinite(readout.integrated) && Math.abs(readout.integrated - target) <= 1 ? "text-meter-ok" : "text-muted-foreground")} data-testid="transport-meter-value" title="Integrated loudness">
              {fmt(readout.integrated)} <span className="text-[9px]">I</span>
            </span>
          </LevelMeter>
        )}
      </div>
    </div>
  );
}
