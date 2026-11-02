import { Slider } from "~/components/ui/slider";
import { TRACK_GAIN_DB } from "~/lib/project/document";
import { cn } from "~/lib/utils";

export const fmtGain = (db: number) => (db === 0 ? "0.0" : `${db > 0 ? "+" : "−"}${Math.abs(db).toFixed(1)}`);

/**
 * A track's volume. The slider is laid out in "fader" units so the useful range gets the room:
 * −60…−24 dB in the bottom fifth, −24…+12 dB across the rest (0 dB sits about three quarters up).
 * Double-click resets to 0 dB; arrow keys step 0.5 dB.
 */
const toPos = (db: number) => (db <= -24 ? ((db - TRACK_GAIN_DB.min) / 36) * 20 : 20 + ((db + 24) / 36) * 80);
const toDb = (pos: number) => (pos <= 20 ? TRACK_GAIN_DB.min + (pos / 20) * 36 : -24 + ((pos - 20) / 80) * 36);

export function TrackFader({ gainDb, onChange, className, testid = "track-fader" }: { gainDb: number; onChange: (db: number) => void; className?: string; testid?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)} onDoubleClick={() => onChange(0)} onClick={(e) => e.stopPropagation()} title="Track volume — double-click for 0 dB">
      <Slider
        min={0}
        max={100}
        step={0.1}
        value={[toPos(gainDb)]}
        onValueChange={([v]) => onChange(Math.round(toDb(v!) * 2) / 2)}
        onKeyDown={(e) => {
          // Home/End/Page keys belong to the transport (go to start/end); they must never slam the fader to an extreme
          if (e.key === "Home" || e.key === "End" || e.key === "PageUp" || e.key === "PageDown") {
            e.preventDefault();
            return;
          }
          if (e.key === "ArrowUp" || e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "ArrowLeft") {
            e.preventDefault();
            e.stopPropagation();
            onChange(Math.max(TRACK_GAIN_DB.min, Math.min(TRACK_GAIN_DB.max, gainDb + (e.key === "ArrowUp" || e.key === "ArrowRight" ? 0.5 : -0.5))));
          }
        }}
        aria-label="Track volume"
        aria-valuetext={`${fmtGain(gainDb)} dB`}
        data-testid={testid}
        className="min-w-0 flex-1"
      />
      <span className={cn("w-[52px] shrink-0 whitespace-nowrap text-right font-mono text-[10.5px] tabular-nums", gainDb === 0 ? "text-muted-foreground" : "text-foreground")} data-testid={`${testid}-value`}>
        {fmtGain(gainDb)} dB
      </span>
    </div>
  );
}
