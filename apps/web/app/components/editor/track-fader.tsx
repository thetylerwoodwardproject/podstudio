import { Fader, FaderRange, FaderThumb, FaderTrack } from "~/components/ui/fader";
import { TRACK_GAIN_DB } from "~/lib/project/document";
import { cn } from "~/lib/utils";
import { guardTransportKeys } from "./transport-keys";

export const fmtGain = (db: number) => (Math.abs(db) < 0.05 ? "0.0" : `${db > 0 ? "+" : "−"}${Math.abs(db).toFixed(1)}`);

/**
 * A track's volume: the audiocn Fader (dB, console taper, 0 dB detent, double-click resets).
 * Arrow keys step 0.5 dB; Home/End stay with the transport.
 */
export function TrackFader({ gainDb, onChange, className, testid = "track-fader" }: { gainDb: number; onChange: (db: number) => void; className?: string; testid?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)} onClick={(e) => e.stopPropagation()} onDoubleClick={() => onChange(0)} title="Track volume — double-click for 0 dB" {...guardTransportKeys}>
      <Fader
        value={gainDb}
        min={TRACK_GAIN_DB.min}
        max={TRACK_GAIN_DB.max}
        step={0.5}
        largeStep={3}
        fineStep={0.1}
        resetValue={0}
        detents={[0]}
        taper="audio"
        orientation="horizontal"
        size="sm"
        onValueChange={(v) => onChange(Math.round(v * 10) / 10)}
        aria-label="Track volume"
        data-testid={testid}
        className="min-w-0 flex-1"
      >
        <FaderTrack>
          <FaderRange />
          <FaderThumb />
        </FaderTrack>
      </Fader>
      <span className={cn("w-[52px] shrink-0 whitespace-nowrap text-right font-mono text-[10.5px] tabular-nums", gainDb === 0 ? "text-muted-foreground" : "text-foreground")} data-testid={`${testid}-value`}>
        {fmtGain(gainDb)} dB
      </span>
    </div>
  );
}
