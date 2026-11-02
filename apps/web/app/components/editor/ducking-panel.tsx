import { faArrowDown, faCheck, faPlus, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Button } from "~/components/ui/button";
import { Range } from "~/components/ui/range";
import { Switch } from "~/components/ui/switch";
import { Toggle } from "~/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import { DUCK, addDuckRule, removeDuckRule, triggerTrackIds, updateDuckRule, type DuckRule, type EditResult, type ProjectDoc, type Track } from "~/lib/project/document";
import { trackColor } from "./draw";

type Edit = (op: (d: ProjectDoc) => EditResult, group?: string) => void;

const fmtDb = (n: number) => `${n.toFixed(0).replace("-", "−")} dB`;
const fmtMs = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 2)} s` : `${v} ms`);

export function DuckingPanel({ doc, onEdit }: { doc: ProjectDoc; onEdit: Edit }) {
  const rules = doc.ducking ?? [];
  const canAdd = rules.length < DUCK.maxRules;
  return (
    <div className="flex flex-col gap-3" data-testid="ducking-panel">
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">Turn music or sound effects down automatically while someone is talking. Sounds the same in the preview and the export.</p>
      {rules.map((r, i) => (
        <RuleCard key={r.id} index={i} doc={doc} rule={r} onEdit={onEdit} />
      ))}
      {rules.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center" data-testid="ducking-empty">
          <MiniEnvelope amountDb={DUCK.amountDb.default} attackMs={DUCK.attackMs.default} releaseMs={DUCK.releaseMs.default} target="var(--speaker-music)" trigger="var(--speaker-host)" muted />
          <p className="text-[13px] font-medium">No ducking yet</p>
          <p className="text-[12px] text-muted-foreground">A typical setup: music dips about 12 dB under the voices and comes back up when they stop.</p>
        </div>
      )}
      <Button variant="outline" size="sm" onClick={() => onEdit((d) => addDuckRule(d))} disabled={!canAdd} data-testid="add-duck-rule" className="self-start">
        <FontAwesomeIcon icon={faPlus} /> {rules.length === 0 ? "Add ducking" : "Add another rule"}
      </Button>
    </div>
  );
}

/** A pill you toggle to include a track; coloured like the track. */
function TrackChip({ track, checked, disabled, onChange, testid, disabledReason }: { track: Track; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; testid: string; disabledReason?: string }) {
  const color = trackColor(track);
  return (
    <Toggle
      variant="outline"
      size="sm"
      pressed={checked}
      disabled={disabled}
      onPressedChange={onChange}
      title={disabled ? disabledReason : undefined}
      data-testid={testid}
      className="h-7 max-w-full rounded-full pl-1.5 pr-2.5 text-[12.5px] font-normal data-[state=on]:border-transparent"
      style={checked ? { background: `color-mix(in srgb, ${color} 22%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 55%, transparent)` } : undefined}
    >
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full text-[8.5px]" style={{ background: checked ? color : "transparent", boxShadow: checked ? undefined : `inset 0 0 0 2px ${color}` }}>
        {checked && <FontAwesomeIcon icon={faCheck} className="text-[#111113]" />}
      </span>
      <span className="truncate">{track.name}</span>
    </Toggle>
  );
}

function RuleCard({ doc, rule, index, onEdit }: { doc: ProjectDoc; rule: DuckRule; index: number; onEdit: Edit }) {
  const set = (patch: Partial<Omit<DuckRule, "id">>, group?: string) => onEdit((d) => updateDuckRule(d, rule.id, patch), group ? `duck-${rule.id}-${group}` : undefined);
  const speech = rule.triggers === "speech";
  const trig = new Set(triggerTrackIds(doc, rule));
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list.filter((x) => x !== id), id] : list.filter((x) => x !== id));
  const explicit = speech ? [] : (rule.triggers as string[]);
  const byId = (id: string) => doc.tracks.find((t) => t.id === id);
  const targetColor = byId(rule.targets[0] ?? "") ? trackColor(byId(rule.targets[0]!)!) : "var(--speaker-music)";
  const firstTrig = [...trig][0];
  const triggerColor = firstTrig && byId(firstTrig) ? trackColor(byId(firstTrig)!) : "var(--speaker-host)";
  const targetNames = rule.targets.map((id) => byId(id)?.name).filter(Boolean) as string[];

  return (
    <section className={cn("overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs", !rule.enabled && "opacity-70")} data-testid="duck-rule">
      {/* header */}
      <div className="flex items-center gap-2.5 px-3 pb-2 pt-3">
        <Switch checked={rule.enabled} onCheckedChange={(v) => set({ enabled: v })} aria-label={rule.enabled ? "Ducking on" : "Ducking off"} data-testid="duck-enabled" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-tight">Ducking{index > 0 ? ` ${index + 1}` : ""}</div>
          <div className="truncate text-[11.5px] leading-tight text-muted-foreground" data-testid="duck-summary">
            {fmtDb(rule.amountDb)} under {speech ? "host + guest" : `${trig.size} track${trig.size === 1 ? "" : "s"}`}
          </div>
        </div>
        <Button variant="ghost" size="icon" aria-label="Remove ducking rule" title="Remove" onClick={() => onEdit((d) => ({ ok: true, doc: removeDuckRule(d, rule.id) }))} data-testid="duck-remove" className="size-7 text-[12px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
          <FontAwesomeIcon icon={faTrashCan} />
        </Button>
      </div>

      {/* what it will do, drawn */}
      <div className="px-3">
        <MiniEnvelope amountDb={rule.amountDb} attackMs={rule.attackMs} releaseMs={rule.releaseMs} target={targetColor} trigger={triggerColor} muted={!rule.enabled} />
      </div>

      {/* targets */}
      <div className="border-t border-border/70 px-3 py-3">
        <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          <FontAwesomeIcon icon={faArrowDown} className="text-[10px]" /> Turn down
        </h4>
        <div className="flex flex-wrap gap-1.5" data-testid="duck-targets">
          {doc.tracks.map((t) => (
            <TrackChip key={t.id} track={t} checked={rule.targets.includes(t.id)} disabled={trig.has(t.id)} disabledReason="This track triggers the ducking" testid={`duck-target-${t.id}`} onChange={(on) => set({ targets: toggle(rule.targets, t.id, on) })} />
          ))}
        </div>
        {targetNames.length === 0 && <p className="mt-1.5 text-[12px] text-muted-foreground">Pick the music or effects to turn down.</p>}
      </div>

      {/* triggers */}
      <div className="border-t border-border/70 px-3 py-3">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">While these are playing</h4>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={speech ? "speech" : "picked"}
          onValueChange={(v) => {
            if (v === "speech" && !speech) set({ triggers: "speech" });
            if (v === "picked" && speech) set({ triggers: doc.tracks.filter((t) => (t.kind === "host" || t.kind === "guest") && !rule.targets.includes(t.id)).map((t) => t.id) });
          }}
          aria-label="What triggers the ducking"
          className="w-full"
        >
          <ToggleGroupItem value="speech" data-testid="duck-trigger-speech" className="flex-1 text-[12.5px]">Host + guest</ToggleGroupItem>
          <ToggleGroupItem value="picked" data-testid="duck-trigger-picked" className="flex-1 text-[12.5px]">Pick tracks</ToggleGroupItem>
        </ToggleGroup>
        {speech ? (
          <p className="mt-2 text-[12px] text-muted-foreground">Every host and guest track, including ones you add later.</p>
        ) : (
          <div className="mt-2" data-testid="duck-triggers">
            <div className="flex flex-wrap gap-1.5">
              {doc.tracks.map((t) => (
                <TrackChip key={t.id} track={t} checked={explicit.includes(t.id)} disabled={rule.targets.includes(t.id)} disabledReason="This track is being turned down" testid={`duck-trigger-${t.id}`} onChange={(on) => set({ triggers: toggle(explicit, t.id, on) })} />
              ))}
            </div>
            {trig.size === 0 && <p className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-[12px] text-destructive">Pick at least one track, or nothing will trigger the ducking.</p>}
          </div>
        )}
      </div>

      {/* levels + timing */}
      <div className="flex flex-col gap-3 border-t border-border/70 bg-secondary/30 px-3 py-3">
        <Slider label="Turn down by" value={rule.amountDb} range={DUCK.amountDb} step={1} format={fmtDb} onChange={(v) => set({ amountDb: v }, "amount")} testid="duck-amount" marks={["−40", "0 dB"]} />
        <Slider label="Starts above" hint="How loud the voice must be before ducking kicks in" value={rule.thresholdDb} range={DUCK.thresholdDb} step={1} format={(v) => `${fmtDb(v)}FS`} onChange={(v) => set({ thresholdDb: v }, "threshold")} testid="duck-threshold" marks={["quieter", "louder"]} />
        <div className="grid grid-cols-2 gap-3">
          <Slider label="Dip speed" value={rule.attackMs} range={DUCK.attackMs} step={1} format={fmtMs} onChange={(v) => set({ attackMs: v }, "attack")} testid="duck-attack" compact />
          <Slider label="Recovery" value={rule.releaseMs} range={DUCK.releaseMs} step={10} format={fmtMs} onChange={(v) => set({ releaseMs: v }, "release")} testid="duck-release" compact />
        </div>
      </div>
    </section>
  );
}

function Slider({ label, hint, value, range, step, format, onChange, testid, marks, compact }: { label: string; hint?: string; value: number; range: { min: number; max: number }; step: number; format: (v: number) => string; onChange: (v: number) => void; testid: string; marks?: [string, string]; compact?: boolean }) {
  return (
    <label className="block" title={hint}>
      <span className={cn("mb-1 flex items-center justify-between gap-2", compact ? "text-[12px]" : "text-[12.5px]")}>
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="shrink-0 rounded bg-background px-1.5 py-0.5 font-mono text-[11.5px] tabular-nums text-foreground shadow-[inset_0_0_0_1px_var(--border)]" data-testid={`${testid}-value`}>
          {format(value)}
        </span>
      </span>
      <Range min={range.min} max={range.max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={testid} />
      {marks && (
        <span className="flex justify-between text-[10.5px] text-muted-foreground/70">
          <span>{marks[0]}</span>
          <span>{marks[1]}</span>
        </span>
      )}
    </label>
  );
}

/**
 * The rule's gain curve on a fixed 5-second scale: a voice burst (shaded) and the target's level
 * dipping by `amountDb` over the attack time, holding, then recovering over the release time.
 * Fixed scale so moving a slider visibly changes the shape.
 */
function MiniEnvelope({ amountDb, attackMs, releaseMs, target, trigger, muted }: { amountDb: number; attackMs: number; releaseMs: number; target: string; trigger: string; muted?: boolean }) {
  const W = 280;
  const H = 64;
  const TOTAL = 5000;
  const top = 10;
  const bottom = H - 8;
  const x = (ms: number) => (Math.min(ms, TOTAL) / TOTAL) * W;
  const y = (db: number) => top + (Math.min(0, Math.max(-40, db)) / -40) * (bottom - top);
  const t0 = 350;
  const hold = 1100;
  const t1 = t0 + attackMs;
  const t2 = t1 + hold;
  const t3 = t2 + releaseMs;
  const pts = [
    [0, y(0)],
    [x(t0), y(0)],
    [x(t1), y(amountDb)],
    [x(t2), y(amountDb)],
    [x(t3), y(0)],
    [W, y(0)],
  ];
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0]!.toFixed(1)},${p[1]!.toFixed(1)}`).join(" ");
  const area = `${line} L${W},${bottom} L0,${bottom} Z`;
  // a little voice-burst waveform inside the trigger region
  const bars: { x: number; h: number }[] = [];
  for (let ms = t0 + 30; ms < t2 - 20; ms += 60) {
    const k = (ms - t0) / 60;
    bars.push({ x: x(ms), h: 6 + Math.abs(Math.sin(k * 1.7) * 9 + Math.sin(k * 0.6) * 5) });
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("block h-16 w-full", muted && "opacity-60")} role="img" aria-label={`Level drops ${Math.abs(amountDb)} dB while the voice plays, then recovers`} data-testid="duck-envelope" preserveAspectRatio="none">
      <rect x={x(t0)} y={2} width={x(t2) - x(t0)} height={H - 4} rx={4} fill={trigger} opacity={0.12} />
      {bars.map((b, i) => (
        <rect key={i} x={b.x - 1} y={H / 2 - b.h / 2} width={2} height={b.h} rx={1} fill={trigger} opacity={0.45} />
      ))}
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeDasharray="3 3" />
      <path d={area} fill={target} opacity={0.14} />
      <path d={line} fill="none" stroke={target} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <text x={x(t0) + 4} y={H - 3} fontSize={8.5} fill="var(--muted-foreground)">voice</text>
      <text x={W - 3} y={y(0) - 2.5} fontSize={8.5} textAnchor="end" fill="var(--muted-foreground)">0 dB</text>
    </svg>
  );
}
