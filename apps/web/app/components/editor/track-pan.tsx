import { PanControl, formatPan } from "~/components/ui/pan-control";
import { cn } from "~/lib/utils";
import { guardTransportKeys } from "./transport-keys";

export const fmtPan = formatPan;

/** A track's pan: the audiocn PanControl (L100 … C … R100, centre detent, double-click recentres). */
export function TrackPan({ pan, onChange, compact, className, testid = "track-pan" }: { pan: number; onChange: (p: number) => void; compact?: boolean; className?: string; testid?: string }) {
  return (
    <div className={cn("flex items-center gap-1.5", className)} onClick={(e) => e.stopPropagation()} onDoubleClick={() => onChange(0)} title="Pan — double-click to center" {...guardTransportKeys}>
      {!compact && <span className="w-6 shrink-0 text-[10px] font-medium text-muted-foreground">Pan</span>}
      <PanControl
        value={pan}
        step={0.05}
        detent
        size="sm"
        onValueChange={(v) => onChange(Math.abs(v) < 0.005 ? 0 : Math.round(v * 100) / 100)}
        data-testid={testid}
        className={cn("min-w-0 flex-1", compact && "w-14 flex-none")}
      />
      <span className={cn("shrink-0 text-right font-mono text-[10.5px] tabular-nums", compact ? "w-7" : "w-[52px]", pan === 0 ? "text-muted-foreground" : "text-foreground")} data-testid={`${testid}-value`}>
        {formatPan(pan)}
      </span>
    </div>
  );
}
