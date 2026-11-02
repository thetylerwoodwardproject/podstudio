import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { faRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { LoudnessMeter, PODCAST_LOUDNESS, TruePeakMeter } from "@podstudio/audio/loudness";
import { Button } from "~/components/ui/button";
import { LevelMeter, LevelMeterBar, LevelMeterChannel, LevelMeterChannels, LevelMeterClip, LevelMeterHold, LevelMeterScale, LevelMeterTrack } from "~/components/ui/level-meter";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { createFrameEmitter, type FrameEmitter } from "~/lib/audio/frame-source";
import type { MeterFrame, MeterZone } from "~/lib/audio/types";
import type { EditorPlayer } from "~/lib/project/player";
import { cn } from "~/lib/utils";

const toDb = (lin: number) => (lin > 0 ? 20 * Math.log10(lin) : Number.NEGATIVE_INFINITY);
const SILENT: MeterFrame = { channels: [{ peakDb: Number.NEGATIVE_INFINITY, rmsDb: Number.NEGATIVE_INFINITY }] };
const SILENT_LR: MeterFrame = { channels: [SILENT.channels[0]!, SILENT.channels[0]!] };

/** Digital reference levels (per the usual dBFS ↔ dBu chart): −18 dBFS reference, −9 dBFS nominal peak. */
export const DBFS_ZONES: MeterZone[] = [
  { fromDb: Number.NEGATIVE_INFINITY, zone: "ok" },
  { fromDb: -18, zone: "warn" },
  { fromDb: -9, zone: "clip" },
];
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
export function useMeters(player: React.RefObject<EditorPlayer | null>, rate: number, trackIds: string[], playing: boolean) {
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
  const lm = useRef<LoudnessMeter | null>(null);
  const tp = useRef<TruePeakMeter | null>(null);
  const [readout, setReadout] = useState<LoudnessReadout>({ momentary: -Infinity, shortTerm: -Infinity, integrated: -Infinity, truePeak: -Infinity, lra: 0 });
  const lastUi = useRef(0);

  const reset = useCallback(() => {
    lm.current = new LoudnessMeter(rate, 1);
    tp.current = new TruePeakMeter(1);
    setReadout({ momentary: -Infinity, shortTerm: -Infinity, integrated: -Infinity, truePeak: -Infinity, lra: 0 });
  }, [rate]);
  useEffect(reset, [reset]);

  // master: the tap's blocks
  useEffect(() => {
    const pl = player.current;
    if (!pl) return;
    pl.onMasterAudio = (left, right) => {
      const level = (x: Float32Array) => {
        let peak = 0;
        let sum = 0;
        for (let i = 0; i < x.length; i++) {
          const v = x[i]!;
          const a = Math.abs(v);
          if (a > peak) peak = a;
          sum += v * v;
        }
        return { peakDb: toDb(peak), rmsDb: toDb(Math.sqrt(sum / x.length)) };
      };
      master.emit({ channels: [level(left), level(right)] });
      // loudness is measured on the mono mix, matching the mono −19 LUFS export target
      const block = new Float32Array(left.length);
      for (let i = 0; i < left.length; i++) block[i] = (left[i]! + right[i]!) / 2;
      const m = lm.current!;
      const t = tp.current!;
      m.push([block]);
      t.push([block]);
      const momentary = m.momentary();
      const shortTerm = m.shortTerm();
      const now = performance.now();
      // integrated and LRA walk the whole history: a few times a second is plenty
      if (now - lastUi.current > 250) {
        lastUi.current = now;
        const integrated = m.integrated();
        setReadout({ momentary, shortTerm, integrated, truePeak: t.db(), lra: m.lra() });
        loud.emit({ channels: [{ peakDb: momentary }, { peakDb: shortTerm }, { peakDb: integrated }] });
      } else {
        setReadout((r) => ({ ...r, momentary, shortTerm }));
        loud.emit({ channels: [{ peakDb: momentary }, { peakDb: shortTerm }, { peakDb: readoutRef.current.integrated }] });
      }
    };
    return () => {
      if (pl.onMasterAudio) pl.onMasterAudio = null;
    };
  }, [player, master, loud]);
  const readoutRef = useRef(readout);
  readoutRef.current = readout;

  // tracks: analyser levels every frame while playing; one silent frame when it stops
  const ids = trackIds.join("|");
  useEffect(() => {
    const list = ids ? ids.split("|") : [];
    if (!playing) {
      for (const id of list) trackSource(id).emit(SILENT);
      master.emit(SILENT_LR);
      return;
    }
    let raf = 0;
    const tick = () => {
      const pl = player.current;
      if (pl) {
        for (const id of list) {
          const { peak, rms } = pl.trackLevel(id);
          trackSource(id).emit({ channels: [{ peakDb: toDb(peak), rmsDb: toDb(rms) }] });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, ids, player, trackSource, master]);

  return { trackSource, master, loud, readout, reset };
}

/** A track's level, horizontally in its header. */
export function TrackMeter({ source, dim }: { source: FrameEmitter<MeterFrame>; dim?: boolean }) {
  return (
    <LevelMeter source={source} variant="segmented" segments={20} size="sm" minDb={-60} maxDb={0} zones={DBFS_ZONES} className={cn("w-full", dim && "opacity-40")} aria-label="Track level" data-testid="track-meter">
      <LevelMeterChannels>
        <LevelMeterChannel index={0}>
          <LevelMeterTrack>
            <LevelMeterBar />
            <LevelMeterHold />
          </LevelMeterTrack>
        </LevelMeterChannel>
      </LevelMeterChannels>
    </LevelMeter>
  );
}

const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d).replace("-", "−") : "−∞");

/** The master meter: dBFS (peak/RMS) or LUFS (momentary / short-term / integrated). Click to switch. */
export function MasterMeter({ master, loud, readout, onReset, mode, onMode }: { master: FrameEmitter<MeterFrame>; loud: FrameEmitter<MeterFrame>; readout: LoudnessReadout; onReset: () => void; mode: "dbfs" | "lufs"; onMode: (m: "dbfs" | "lufs") => void }) {
  const target = PODCAST_LOUDNESS.mono; // the preview is the mono mix
  const toggle = () => onMode(mode === "dbfs" ? "lufs" : "dbfs");
  const zones = useMemo(() => lufsZones(target), [target]);
  const top = -6;
  const bottom = -42;
  const targetPct = ((target - bottom) / (top - bottom)) * 100;
  return (
    <aside className="flex w-[118px] min-h-0 shrink-0 flex-col border-l border-border bg-card/40" aria-label="Master meter" data-testid="master-meter" data-mode={mode}>
      <div className="flex shrink-0 flex-col items-center gap-1.5 border-b border-border px-2 py-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Master</span>
        <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(v) => v && onMode(v as "dbfs" | "lufs")} aria-label="Meter scale" className="w-full">
          <ToggleGroupItem value="dbfs" className="h-6 flex-1 px-0 text-[11px]" data-testid="meter-mode-dbfs">dBFS</ToggleGroupItem>
          <ToggleGroupItem value="lufs" className="h-6 flex-1 px-0 text-[11px]" data-testid="meter-mode-lufs">LUFS</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <button type="button" onClick={toggle} title={`Click to show ${mode === "dbfs" ? "loudness (LUFS)" : "levels (dBFS)"}`} className="flex min-h-0 flex-1 cursor-pointer flex-col items-center px-2 pb-2 pt-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50" data-testid="master-meter-body">
        {mode === "dbfs" ? (
          <LevelMeter source={master} orientation="vertical" variant="segmented" segments={40} minDb={-60} maxDb={0} zones={DBFS_ZONES} className="min-h-0 w-full flex-1 items-center" aria-label="Master level, dBFS">
            <LevelMeterClip />
            {/* the bars are the centred block; the scale hangs off their right edge so it doesn't push them over */}
            <div className="relative h-full min-h-0 w-fit flex-1" data-testid="master-bars">
              <LevelMeterChannels className="h-full gap-1">
                {[0, 1].map((i) => (
                  <LevelMeterChannel key={i} index={i} className="h-full">
                    <LevelMeterTrack className="h-full w-3" data-testid={`master-${i ? "right" : "left"}`}>
                      <LevelMeterBar />
                      <LevelMeterHold />
                    </LevelMeterTrack>
                  </LevelMeterChannel>
                ))}
              </LevelMeterChannels>
              <LevelMeterScale ticks={[0, -3, -6, -9, -12, -18, -24, -30, -40, -50, -60]} className="absolute inset-y-0 left-[calc(100%+4px)] h-full text-[9.5px]" />
            </div>
            <div className="mt-1 grid w-[28px] grid-cols-2 gap-1 text-center text-[9px] font-semibold text-muted-foreground"><span>L</span><span>R</span></div>
            <MasterValue source={master} />
          </LevelMeter>
        ) : (
          <div className="flex min-h-0 w-full flex-1 flex-col items-center">
            <LevelMeter source={loud} channelCount={3} orientation="vertical" ballistics="instant" minDb={bottom} maxDb={top} zones={zones} className="min-h-0 flex-1" aria-label="Loudness, LUFS">
              <div className="relative h-full w-fit" data-testid="lufs-bars">
                <LevelMeterChannels className="h-full gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <LevelMeterChannel key={i} index={i} className="h-full">
                      <LevelMeterTrack className="h-full w-3.5">
                        <LevelMeterBar />
                      </LevelMeterTrack>
                    </LevelMeterChannel>
                  ))}
                </LevelMeterChannels>
                {/* target line across the bars */}
                <div className="pointer-events-none absolute inset-x-[-3px] h-0.5 rounded bg-meter-warn" style={{ bottom: `${targetPct}%` }} title={`Target ${target} LUFS`} data-testid="lufs-target" />
                <LevelMeterScale ticks={[-6, -10, -14, -16, -19, -23, -27, -32, -36, -42]} className="absolute inset-y-0 left-[calc(100%+4px)] h-full text-[9.5px]" />
              </div>
            </LevelMeter>
            <div className="mt-1 grid w-[54px] grid-cols-3 gap-1.5 text-center text-[9.5px] font-semibold text-muted-foreground">
              <span title="Momentary (400 ms)">M</span>
              <span title="Short-term (3 s)">S</span>
              <span title="Integrated (since reset)">I</span>
            </div>
          </div>
        )}
      </button>

      <div className="shrink-0 border-t border-border px-2 py-2 text-center" data-testid="loudness-readout">
        <div className={cn("font-mono text-[18px] font-semibold leading-none tabular-nums", Number.isFinite(readout.integrated) && Math.abs(readout.integrated - target) <= 1 ? "text-ok" : Number.isFinite(readout.integrated) && readout.integrated > target + 1 ? "text-meter-warn" : "")} data-testid="lufs-integrated">
          {fmt(readout.integrated)}
        </div>
        <div className="text-[10px] text-muted-foreground">LUFS integrated</div>
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-1.5 text-left font-mono text-[10.5px] tabular-nums">
          <dt className="text-muted-foreground">M</dt>
          <dd className="text-right" data-testid="lufs-momentary">{fmt(readout.momentary)}</dd>
          <dt className="text-muted-foreground">S</dt>
          <dd className="text-right">{fmt(readout.shortTerm)}</dd>
          <dt className="text-muted-foreground">TP</dt>
          <dd className={cn("text-right", readout.truePeak > PODCAST_LOUDNESS.truePeakDb && "text-destructive")} data-testid="lufs-tp">{fmt(readout.truePeak)}</dd>
          <dt className="text-muted-foreground">LRA</dt>
          <dd className="text-right">{fmt(readout.lra)}</dd>
        </dl>
        <Button variant="ghost" size="sm" onClick={onReset} className="mt-1 h-6 w-full px-1 text-[11px] text-muted-foreground" title="Start measuring integrated loudness, LRA and true peak again" data-testid="loudness-reset">
          <FontAwesomeIcon icon={faRotateLeft} /> Reset
        </Button>
        <p className="mt-1 text-[9.5px] leading-tight text-muted-foreground">Export target {target} LUFS mono · −16 stereo</p>
      </div>
    </aside>
  );
}

/** Current master peak in dBFS, under the bar. */
function MasterValue({ source }: { source: FrameEmitter<MeterFrame> }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(
    () =>
      source.subscribe((f) => {
        if (ref.current) ref.current.textContent = fmt(Math.max(...f.channels.map((c) => c.peakDb)));
      }),
    [source],
  );
  return (
    <span className="mt-1.5 font-mono text-[11px] tabular-nums text-muted-foreground" data-testid="dbfs-value">
      <span ref={ref}>−∞</span> dBFS
    </span>
  );
}

/** The simple editor's master meter: horizontal, in the transport bar. Click to switch dBFS ⇄ LUFS. */
export function TransportMeter({ master, loud, readout, mode, onMode }: { master: FrameEmitter<MeterFrame>; loud: FrameEmitter<MeterFrame>; readout: LoudnessReadout; mode: "dbfs" | "lufs"; onMode: (m: "dbfs" | "lufs") => void }) {
  const target = PODCAST_LOUDNESS.mono;
  const zones = useMemo(() => lufsZones(target), [target]);
  return (
    <button
      type="button"
      onClick={() => onMode(mode === "dbfs" ? "lufs" : "dbfs")}
      title={mode === "dbfs" ? "Master level (dBFS) — click for loudness (LUFS)" : "Master loudness: momentary / short-term / integrated — click for levels (dBFS)"}
      className="grid h-12 w-[320px] grid-cols-[52px_minmax(0,1fr)_52px] items-center gap-2 rounded-md border border-border bg-background/60 px-2 outline-none hover:border-ring/50 focus-visible:ring-2 focus-visible:ring-ring/50"
      data-testid="transport-meter"
      data-mode={mode}
    >
      <span className="text-center text-[9.5px] font-semibold uppercase leading-tight tracking-[0.06em] text-muted-foreground">{mode === "dbfs" ? "dBFS" : "LUFS"}</span>
      {/* the meter block (bars + scale) is centred in the middle column, both ways */}
      <div className="flex min-w-0 items-center justify-center" data-testid="transport-meter-block">
        {mode === "dbfs" ? (
          <LevelMeter source={master} variant="segmented" segments={36} size="sm" minDb={-60} maxDb={0} zones={DBFS_ZONES} className="w-full" aria-label="Master level, dBFS, left and right">
            {/* bars and scale share one positioned box, so the scale sits right under the bars */}
            <div className="relative w-full">
            <LevelMeterChannels className="gap-[3px]">
              {[0, 1].map((i) => (
                <LevelMeterChannel key={i} index={i} className="relative">
                  <span className="absolute -left-2.5 top-1/2 -translate-y-1/2 text-[7.5px] font-semibold leading-none text-muted-foreground">{i ? "R" : "L"}</span>
                  <LevelMeterTrack className="w-full" data-testid={`transport-${i ? "right" : "left"}`}>
                    <LevelMeterBar />
                    <LevelMeterHold />
                  </LevelMeterTrack>
                </LevelMeterChannel>
              ))}
            </LevelMeterChannels>
            <LevelMeterScale ticks={[-60, -40, -30, -18, -9, -3, 0]} className="text-[8px]" />
            </div>
          </LevelMeter>
        ) : (
          <LevelMeter source={loud} channelCount={3} ballistics="instant" size="sm" minDb={-42} maxDb={-6} zones={zones} className="w-full" aria-label="Loudness, LUFS: momentary, short-term, integrated">
            <div className="relative w-full">
            <LevelMeterChannels className="relative gap-[2px]">
              {[0, 1, 2].map((i) => (
                <LevelMeterChannel key={i} index={i} className="relative">
                  <span className="absolute -left-2.5 top-1/2 -translate-y-1/2 text-[7px] font-semibold leading-none text-muted-foreground">{"MSI"[i]}</span>
                  <LevelMeterTrack className="w-full">
                    <LevelMeterBar />
                  </LevelMeterTrack>
                </LevelMeterChannel>
              ))}
              <div className="pointer-events-none absolute inset-y-[-2px] w-0.5 rounded bg-meter-warn" style={{ left: `${((target + 42) / 36) * 100}%` }} title={`Target ${target} LUFS`} />
            </LevelMeterChannels>
            <LevelMeterScale ticks={[-42, -32, -23, -19, -14, -6]} className="text-[8px]" />
            </div>
          </LevelMeter>
        )}
      </div>
      <span className="text-center font-mono text-[12px] font-semibold tabular-nums" data-testid="transport-meter-value">
        {mode === "lufs" ? (
          <span className={cn(Number.isFinite(readout.integrated) && Math.abs(readout.integrated - target) <= 1 && "text-ok")}>
            {fmt(readout.integrated)}
            <span className="ml-0.5 text-[9px] font-normal text-muted-foreground">I</span>
          </span>
        ) : (
          <MasterValueBare source={master} />
        )}
      </span>
    </button>
  );
}

function MasterValueBare({ source }: { source: FrameEmitter<MeterFrame> }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(
    () =>
      source.subscribe((f) => {
        if (ref.current) ref.current.textContent = fmt(Math.max(...f.channels.map((c) => c.peakDb)));
      }),
    [source],
  );
  return <span ref={ref}>−∞</span>;
}
