import { useEffect, useMemo, useRef, useState } from "react";
import { faRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { FX_RANGES, defaultFx, fxActive, fxCurveDb, type TrackFx } from "@podstudio/audio/fx";
import { Button } from "~/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Knob, KnobDial, KnobLabel, KnobPointer, KnobRange, KnobTrack, KnobValue } from "~/components/ui/knob";
import { LcdDisplay, LcdDisplayLabel, LcdDisplayRow, LcdDisplayValue } from "~/components/ui/lcd-display";
import { Spectrum, SpectrumCanvas, SpectrumFrequencyAxis } from "~/components/ui/spectrum";
import { Switch } from "~/components/ui/switch";
import { createFrameEmitter } from "~/lib/audio/frame-source";
import type { VisualFrame } from "~/lib/audio/types";
import { DUCK, triggerTrackIds, updateDuckRule, type EditResult, type ProjectDoc, type Track } from "~/lib/project/document";
import { MiniEnvelope, TrackChip, setTrackDucking, trackDuckRule } from "./ducking-panel";
import { PODCAST_PRESETS } from "./fx-builtins";
import { trackColor } from "./draw";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import type { EditorPlayer } from "~/lib/project/player";
import { cn } from "~/lib/utils";
import { TrackFader } from "./track-fader";
import { guardTransportKeys } from "./transport-keys";

// Formats per the README: "−2.0 dB", "120 Hz", "2.5 kHz"; one value per line, never wrapping.
const fmtDb = (v: number) => `${v < -0.05 ? "−" : v > 0.05 ? "+" : ""}${Math.abs(v).toFixed(1)} dB`;
const fmtHz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2).replace(/\.?0+$/, "")} kHz` : `${Math.round(v)} Hz`);
const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const parseNum = (t: string) => {
  const m = t.replace("−", "-").match(/-?[\d.]+/);
  if (!m) return null;
  const n = Number(m[0]);
  return /k/i.test(t) ? n * 1000 : /%/.test(t) ? n / 100 : n;
};

/** One audiocn Knob with its label on top and value below. */
function FxKnob({ label, value, min, max, log, origin, size = "default", format, onChange, disabled, testid, reset }: { label: string; value: number; min: number; max: number; log?: boolean; origin?: number; size?: "sm" | "default" | "lg"; format: (v: number) => string; onChange: (v: number) => void; disabled?: boolean; testid: string; reset: number }) {
  return (
    <Knob
      value={value}
      min={min}
      max={max}
      scale={log ? "log" : "linear"}
      origin={origin}
      resetValue={reset}
      size={size}
      format={format}
      parse={parseNum}
      disabled={disabled}
      onValueChange={(v) => onChange(v)}
      className="flex flex-col items-center gap-0.5"
      data-testid={testid}
    >
      <KnobLabel className="text-[11.5px] text-muted-foreground">{label}</KnobLabel>
      <KnobDial>
        <KnobTrack />
        <KnobRange />
        <KnobPointer />
      </KnobDial>
      <KnobValue className="text-[11.5px]" data-testid={`${testid}-value`} />
    </Knob>
  );
}

/** The EQ curve (filters included) over the track's live spectrum, on one log-frequency axis. */
function EqDisplay({ fx, player, trackId, playing, className }: { fx: TrackFx; player: React.RefObject<EditorPlayer | null>; trackId: string; playing: boolean; className?: string }) {
  const frames = useMemo(() => createFrameEmitter<VisualFrame>(), []);
  useEffect(() => {
    if (!playing) return;
    const bands = new Float32Array(64);
    let raf = 0;
    const tick = () => {
      if (player.current?.trackSpectrum(trackId, bands)) frames.emit({ bands: bands.slice(), history: new Float32Array(0), historyStart: 0, historyLength: 0, peakDb: 0 });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, player, trackId, frames]);
  const W = 300;
  const H = 96;
  const path = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= W; i++) {
      const f = 20 * Math.pow(1000, i / W);
      const db = Math.max(-18, Math.min(18, fxCurveDb(fx, f)));
      pts.push(`${i ? "L" : "M"}${i},${(H / 2 - (db / 18) * (H / 2 - 4)).toFixed(1)}`);
    }
    return pts.join(" ");
  }, [fx]);
  return (
    <Spectrum source={frames} variant="area" scale="log" minHz={20} maxHz={20000} grid={false} peakHold={false} className={cn("flex h-full flex-col gap-1 rounded-md border border-border bg-background p-1.5", className)} aria-label="Track spectrum and EQ curve" data-testid="fx-eq-display">
      <div className="relative min-h-0 flex-1">
        <SpectrumCanvas className="absolute inset-0 h-full w-full opacity-60" />
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-label="EQ curve" data-testid="fx-eq-curve">
          <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="var(--border)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <path d={path} fill="none" stroke="var(--primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <SpectrumFrequencyAxis ticks={[100, 1000, 10000]} />
    </Spectrum>
  );
}

type FxSlot = "nr" | "hpf" | "lpf" | "eq" | "comp" | "duck" | "volume";
/** The chain in signal order, as Hindenburg lists it: click one to edit it, switch it on/off in place. */
const FX_SLOTS: { id: FxSlot; label: string; toggle?: (f: TrackFx, on: boolean) => void }[] = [
  { id: "nr", label: "Noise reduction", toggle: (f, on) => (f.nr.on = on) },
  { id: "hpf", label: "High-pass", toggle: (f, on) => (f.hpf.on = on) },
  { id: "lpf", label: "Low-pass", toggle: (f, on) => (f.lpf.on = on) },
  { id: "eq", label: "EQ" },
  { id: "comp", label: "Compressor", toggle: (f, on) => (f.comp.on = on) },
  { id: "duck", label: "Ducking" },
  { id: "volume", label: "Volume" },
];
const slotOn = (fx: TrackFx, id: FxSlot) => (id === "nr" ? fx.nr.on : id === "hpf" ? fx.hpf.on : id === "lpf" ? fx.lpf.on : id === "comp" ? fx.comp.on : id === "eq" ? fx.eq.low.gainDb !== 0 || fx.eq.mid.gainDb !== 0 || fx.eq.high.gainDb !== 0 : false);
/** The effect last opened, so the panel comes back where you left it. */
let lastPane: FxSlot = "nr";

/**
 * A track's FX (noise reduction, filters, 3-band EQ, compressor) and volume. Every control is real:
 * the same settings drive the preview's AudioWorklet and the export render (packages/audio/src/fx.ts).
 */
export function FxPanel({ track, doc, onFx, onGain, onDuck, player, playing }: { track: Track; doc: ProjectDoc; onFx: (fx: TrackFx | null) => void; onGain: (db: number) => void; onDuck: (op: (d: ProjectDoc) => EditResult, group?: string) => void; player: React.RefObject<EditorPlayer | null>; playing: boolean }) {
  const fx = track.fx ?? defaultFx();
  const set = (patch: (f: TrackFx) => void) => {
    const next = structuredClone(fx);
    patch(next);
    onFx(next);
  };
  // A/B: two snapshots for this session; switching swaps which one is live
  const [ab, setAb] = useState<{ slot: "A" | "B"; other: TrackFx } | null>(null);
  const [presets, setPresets] = useState<{ id: string; name: string; fx: TrackFx }[]>([]);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => {
    void fetch("/studio/fx-presets").then(async (r) => r.ok && setPresets((await r.json()).presets));
  }, []);
  // compressor gain reduction readout
  const [gr, setGr] = useState(0);
  const grRef = useRef(0);
  useEffect(() => {
    if (!playing) {
      setGr(0);
      return;
    }
    const t = window.setInterval(() => {
      const v = player.current?.trackGainReduction(track.id) ?? 0;
      grRef.current = Math.min(v, grRef.current * 0.6);
      setGr(grRef.current);
    }, 80);
    return () => window.clearInterval(t);
  }, [playing, player, track.id]);
  const off = !fx.on;
  const duckRule = trackDuckRule(doc, track.id);
  const [pane, setPane] = useState<FxSlot>(() => lastPane);
  useEffect(() => {
    lastPane = pane;
  }, [pane]);

  return (
    <div className="flex flex-col gap-4 text-[12.5px]" data-testid="fx-panel" {...guardTransportKeys}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-2 text-[12px] text-muted-foreground" data-testid="fx-title">FX for <b className="text-foreground">{track.name}</b></span>
        <label className="mr-1 flex items-center gap-1.5 text-[12px] font-medium">
          <Switch checked={fx.on} onCheckedChange={(v) => set((f) => (f.on = v))} aria-label="FX on" data-testid="fx-on" />
          {fx.on ? "On" : "Bypassed"}
        </label>
        <Button
          variant={ab ? "secondary" : "outline"}
          size="sm"
          className="h-7 px-2 text-[11.5px]"
          title="A/B: keep two versions of these settings and flip between them"
          data-testid="fx-ab"
          onClick={() => {
            if (!ab) {
              setAb({ slot: "B", other: structuredClone(fx) });
              return;
            }
            const live = structuredClone(fx);
            onFx(ab.other);
            setAb({ slot: ab.slot === "A" ? "B" : "A", other: live });
          }}
        >
          {ab ? <>A/B: <b className="ml-1">{ab.slot}</b></> : "A/B"}
        </Button>
        <Button variant="outline" size="sm" className="h-7 px-2 text-[11.5px]" onClick={() => onFx(null)} title="Everything off and flat" data-testid="fx-reset">
          <FontAwesomeIcon icon={faRotateLeft} /> Flat
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 px-2 text-[11.5px]" data-testid="fx-presets">Presets</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[min(520px,var(--radix-dropdown-menu-content-available-height))] w-80 overflow-y-auto">
            <DropdownMenuLabel className="font-normal text-muted-foreground">Podcast presets</DropdownMenuLabel>
            {PODCAST_PRESETS.map((b) => (
              <DropdownMenuItem key={b.id} onSelect={() => onFx(structuredClone(b.fx))} title={b.hint} className="flex-col items-start gap-0" data-testid={`fx-builtin-${b.id}`}>
                <span>{b.name}</span>
                <span className="text-[11px] leading-snug text-muted-foreground">{b.hint}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="font-normal text-muted-foreground">Show presets</DropdownMenuLabel>
            {presets.length === 0 && <DropdownMenuItem disabled>None saved yet</DropdownMenuItem>}
            {presets.map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => onFx(p.fx)} data-testid="fx-preset-item">{p.name}</DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setSaving(true)} data-testid="fx-preset-save">Save these settings as a show preset…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="ml-auto text-[11px] text-muted-foreground" title="Order: noise reduction → filters → EQ → compressor → volume. The preview plays exactly what the export renders." data-testid="fx-status">
          {!fx.on ? (duckRule?.enabled ? "FX bypassed; ducking still on" : "Bypassed: the track plays dry") : fxActive(fx) || duckRule?.enabled ? "Plays exactly as it will export" : "Nothing is changing the sound yet"}
        </span>
      </div>
      {saving && (
        <form
          className="flex gap-1.5"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await fetch("/studio/fx-presets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, fx }) });
            if (r.ok) setPresets((await r.json()).presets);
            setSaving(false);
            setName("");
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Preset name, e.g. Tyler's voice" maxLength={60} className="h-8 text-[12px]" data-testid="fx-preset-name" />
          <Button type="submit" size="sm" className="h-8" disabled={!name.trim()}>Save</Button>
        </form>
      )}

      {/* Hindenburg-style: the chain on the left (each effect switches on/off right there), the
          selected effect's controls on the right — one effect at a time instead of all at once. */}
      <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-4">
        <ul className="flex flex-col gap-0.5" role="tablist" aria-label="Effects" aria-orientation="vertical" data-testid="fx-chain">
          {FX_SLOTS.map((slot) => {
            const isDuck = slot.id === "duck";
            const on = isDuck ? !!duckRule?.enabled : slotOn(fx, slot.id);
            const lit = isDuck ? on : on && fx.on;
            return (
              <li key={slot.id} className={cn("flex h-10 items-center gap-2.5 rounded-md pr-2 pl-3", pane === slot.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground")}>
                <button type="button" role="tab" aria-selected={pane === slot.id} onClick={() => setPane(slot.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13.5px] outline-none focus-visible:underline" data-testid={`fx-tab-${slot.id}`}>
                  <span className={cn("size-1.5 shrink-0 rounded-full", lit ? "bg-primary" : "bg-muted-foreground/30")} aria-hidden />
                  <span className="truncate">{slot.label}</span>
                  {slot.id === "volume" && <span className="ml-auto font-mono text-[10.5px] tabular-nums">{(track.gainDb ?? 0) === 0 ? "0.0" : fmtDb(track.gainDb ?? 0).replace(" dB", "")} dB</span>}
                </button>
                {isDuck && <Switch size="sm" checked={on} onCheckedChange={(v) => { onDuck((d) => setTrackDucking(d, track.id, v)); setPane("duck"); }} aria-label="Ducking on" data-testid="fx-duck-on" />}
                {slot.toggle && <Switch size="sm" checked={on} onCheckedChange={(v) => { set((f) => slot.toggle!(f, v)); setPane(slot.id); }} aria-label={`${slot.label} on`} data-testid={`fx-${slot.id}-on`} disabled={off} />}
              </li>
            );
          })}
        </ul>

        <div className={cn("flex min-h-[300px] gap-5 rounded-xl border border-border bg-card/40 p-5", off && pane !== "volume" && pane !== "duck" && "pointer-events-none opacity-50")} role="tabpanel" data-testid={`fx-pane-${pane}`}>
          {(pane === "hpf" || pane === "lpf" || pane === "eq") && <EqDisplay fx={fx} player={player} trackId={track.id} playing={playing} className="h-auto min-h-[256px] w-[300px] shrink-0" />}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="mb-2 flex items-center gap-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{FX_SLOTS.find((x) => x.id === pane)!.label}</h4>
              {pane === "eq" && <Button variant="ghost" size="sm" className="ml-auto h-6 px-1.5 text-[11px] text-muted-foreground" onClick={() => set((f) => { f.eq.low.gainDb = 0; f.eq.mid.gainDb = 0; f.eq.high.gainDb = 0; })}>Flat</Button>}
            </div>
            <div className="flex flex-1 items-center justify-center gap-5">
              {pane === "nr" && (
                <>
                  <FxKnob size="lg" label="Reduction" value={fx.nr.amount} min={0} max={1} reset={0.5} format={(v) => `${fmtPct(v)} · ${Math.round(v * 20)} dB`} disabled={!fx.nr.on} onChange={(v) => set((f) => (f.nr.amount = v))} testid="fx-nr-amount" />
                  <p className="max-w-[220px] text-[11.5px] leading-snug text-muted-foreground">Removes steady noise — hiss, hum, fans, room tone — between and under words. Start around 50% and listen with it on and off.</p>
                </>
              )}
              {pane === "hpf" && <FxKnob size="lg" label="Cutoff" value={fx.hpf.freq} min={FX_RANGES.hpf.min} max={FX_RANGES.hpf.max} log reset={80} format={fmtHz} disabled={!fx.hpf.on} onChange={(v) => set((f) => (f.hpf.freq = v))} testid="fx-hpf-freq" />}
              {pane === "lpf" && <FxKnob size="lg" label="Cutoff" value={fx.lpf.freq} min={FX_RANGES.lpf.min} max={FX_RANGES.lpf.max} log reset={16000} format={fmtHz} disabled={!fx.lpf.on} onChange={(v) => set((f) => (f.lpf.freq = v))} testid="fx-lpf-freq" />}
              {pane === "eq" && (
                <div className="grid grid-cols-3 gap-x-6 gap-y-2" data-testid="fx-eq">
                  {(["low", "mid", "high"] as const).map((b) => (
                    <div key={b} className="flex flex-col items-center gap-0.5">
                      <FxKnob size="lg" label={b === "low" ? "Low" : b === "mid" ? "Mid" : "High"} value={fx.eq[b].gainDb} min={-12} max={12} origin={0} reset={0} format={fmtDb} onChange={(v) => set((f) => (f.eq[b].gainDb = Math.round(v * 10) / 10))} testid={`fx-eq-${b}-gain`} />
                      <FxKnob label="" value={fx.eq[b].freq} min={FX_RANGES[b].min} max={FX_RANGES[b].max} log reset={b === "low" ? 120 : b === "mid" ? 2500 : 8000} format={fmtHz} onChange={(v) => set((f) => (f.eq[b].freq = v))} testid={`fx-eq-${b}-freq`} />
                    </div>
                  ))}
                </div>
              )}
              {pane === "comp" && (
                <div className="flex items-center gap-5" data-testid="fx-comp">
                  <FxKnob size="lg" label="Amount" value={fx.comp.amount} min={0} max={1} reset={0.4} format={fmtPct} disabled={!fx.comp.on} onChange={(v) => set((f) => (f.comp.amount = v))} testid="fx-comp-amount" />
                  <LcdDisplay size="sm" variant="primary" className="w-[150px] whitespace-nowrap" data-testid="fx-comp-gr">
                    <LcdDisplayRow>
                      <LcdDisplayLabel>GR</LcdDisplayLabel>
                      <LcdDisplayValue>{fx.comp.on && gr < -0.05 ? fmtDb(gr) : "0.0 dB"}</LcdDisplayValue>
                    </LcdDisplayRow>
                  </LcdDisplay>
                  <p className="max-w-[180px] text-[11.5px] leading-snug text-muted-foreground">Evens out loud and quiet words. One knob sets threshold, ratio and make-up together.</p>
                </div>
              )}
              {pane === "duck" && <DuckPane doc={doc} track={track} onDuck={onDuck} />}
              {pane === "volume" && <TrackFader gainDb={track.gainDb ?? 0} onChange={onGain} testid="fx-fader" className="w-full max-w-[320px]" />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const fmtDuckDb = (n: number) => `${Math.round(n).toString().replace("-", "−")} dB`;
const fmtMs = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2).replace(/\.?0+$/, "")} s` : `${Math.round(v)} ms`);

/** Per-track ducking: this track dips while the voices (or picked tracks) are talking. */
function DuckPane({ doc, track, onDuck }: { doc: ProjectDoc; track: Track; onDuck: (op: (d: ProjectDoc) => EditResult, group?: string) => void }) {
  const rule = trackDuckRule(doc, track.id);
  if (!rule || !rule.enabled) {
    return (
      <div className="flex max-w-[380px] flex-col items-center gap-2 text-center" data-testid="fx-duck-off">
        <MiniEnvelope amountDb={DUCK.amountDb.default} attackMs={DUCK.attackMs.default} releaseMs={DUCK.releaseMs.default} target={trackColor(track)} trigger="var(--speaker-host)" muted />
        <p className="text-[12px] text-muted-foreground">Turn {track.name} down automatically while someone is talking, and back up in the gaps. Switch it on in the list. Sounds the same in the preview and the export.</p>
      </div>
    );
  }
  const set = (patch: Parameters<typeof updateDuckRule>[2], group?: string) => onDuck((d) => updateDuckRule(d, rule.id, patch), group ? `duck-${rule.id}-${group}` : undefined);
  const speech = rule.triggers === "speech";
  const explicit = speech ? [] : (rule.triggers as string[]);
  const trig = triggerTrackIds(doc, rule);
  const first = doc.tracks.find((t) => t.id === trig[0]);
  const others = doc.tracks.filter((t) => t.id !== track.id);
  return (
    <div className="flex w-full flex-col gap-3" data-testid="fx-duck">
      <div className="flex items-center justify-center gap-4 [&_[data-slot=knob-label]]:whitespace-nowrap">
        <FxKnob size="lg" label="Turn down by" value={rule.amountDb} min={DUCK.amountDb.min} max={DUCK.amountDb.max} reset={DUCK.amountDb.default} format={fmtDuckDb} onChange={(v) => set({ amountDb: Math.round(v) }, "amount")} testid="fx-duck-amount" />
        <FxKnob label="Starts above" value={rule.thresholdDb} min={DUCK.thresholdDb.min} max={DUCK.thresholdDb.max} reset={DUCK.thresholdDb.default} format={(v) => `${fmtDuckDb(v)}FS`} onChange={(v) => set({ thresholdDb: Math.round(v) }, "threshold")} testid="fx-duck-threshold" />
        <FxKnob label="Dip speed" value={rule.attackMs} min={DUCK.attackMs.min} max={DUCK.attackMs.max} log reset={DUCK.attackMs.default} format={fmtMs} onChange={(v) => set({ attackMs: Math.round(v) }, "attack")} testid="fx-duck-attack" />
        <FxKnob label="Recovery" value={rule.releaseMs} min={DUCK.releaseMs.min} max={DUCK.releaseMs.max} log reset={DUCK.releaseMs.default} format={fmtMs} onChange={(v) => set({ releaseMs: Math.round(v / 10) * 10 }, "release")} testid="fx-duck-release" />
        <div className="w-[170px] shrink-0"><MiniEnvelope amountDb={rule.amountDb} attackMs={rule.attackMs} releaseMs={rule.releaseMs} target={trackColor(track)} trigger={first ? trackColor(first) : "var(--speaker-host)"} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-muted-foreground">While these talk</span>
        <ToggleGroup type="single" variant="outline" size="sm" value={speech ? "speech" : "picked"} onValueChange={(v) => {
          if (v === "speech" && !speech) set({ triggers: "speech" });
          if (v === "picked" && speech) set({ triggers: others.filter((t) => t.kind === "host" || t.kind === "guest").map((t) => t.id) });
        }} aria-label="What triggers the ducking">
          <ToggleGroupItem value="speech" className="h-7 px-2.5 text-[12px]" data-testid="fx-duck-speech">Host + guest</ToggleGroupItem>
          <ToggleGroupItem value="picked" className="h-7 px-2.5 text-[12px]" data-testid="fx-duck-picked">Pick tracks</ToggleGroupItem>
        </ToggleGroup>
        {!speech && others.map((t) => (
          <TrackChip key={t.id} track={t} checked={explicit.includes(t.id)} onChange={(on) => set({ triggers: on ? [...explicit.filter((x) => x !== t.id), t.id] : explicit.filter((x) => x !== t.id) })} testid={`fx-duck-trigger-${t.id}`} />
        ))}
        {trig.length === 0 && <span className="text-[11.5px] text-meter-warn">Nothing triggers it yet: pick a track, or add a host or guest track.</span>}
      </div>
    </div>
  );
}
