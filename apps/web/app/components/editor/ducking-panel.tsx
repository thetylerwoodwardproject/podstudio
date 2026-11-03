import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Toggle } from "~/components/ui/toggle";
import { cn } from "~/lib/utils";
import { addDuckRule, updateDuckRule, type DuckRule, type EditResult, type ProjectDoc, type Track } from "~/lib/project/document";
import { trackColor } from "./draw";



/** A pill you toggle to include a track; coloured like the track. */
export function TrackChip({ track, checked, disabled, onChange, testid, disabledReason }: { track: Track; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; testid: string; disabledReason?: string }) {
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

/**
 * The rule's gain curve on a fixed 5-second scale: a voice burst (shaded) and the target's level
 * dipping by `amountDb` over the attack time, holding, then recovering over the release time.
 * Fixed scale so moving a slider visibly changes the shape.
 */
export function MiniEnvelope({ amountDb, attackMs, releaseMs, target, trigger, muted }: { amountDb: number; attackMs: number; releaseMs: number; target: string; trigger: string; muted?: boolean }) {
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

/** The ducking rule that turns this track down, if any (per-track ducking lives in the track's FX). */
export function trackDuckRule(doc: ProjectDoc, trackId: string): DuckRule | undefined {
  return doc.ducking?.find((r) => r.targets.includes(trackId));
}

/** Switch ducking for one track: reuse its rule, or add one that turns just this track down under the voices. */
export function setTrackDucking(doc: ProjectDoc, trackId: string, on: boolean): EditResult {
  const rule = trackDuckRule(doc, trackId);
  if (on) {
    if (rule) return updateDuckRule(doc, rule.id, { enabled: true });
    const added = addDuckRule(doc);
    if (!added.ok) return added;
    const fresh = added.doc.ducking![added.doc.ducking!.length - 1]!;
    return updateDuckRule(added.doc, fresh.id, { targets: [trackId] });
  }
  if (!rule) return { ok: true, doc };
  // a rule shared with other tracks keeps running for them; this track just leaves it
  if (rule.targets.length > 1) return updateDuckRule(doc, rule.id, { targets: rule.targets.filter((id) => id !== trackId) });
  return updateDuckRule(doc, rule.id, { enabled: false });
}
