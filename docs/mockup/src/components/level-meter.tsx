import { cn } from "@/lib/utils"

const MIN = -60

/** Bar meter on a −60…0 dBFS scale: green below −12, amber to −3, red above or on clip. Peak tick optional. */
export function LevelMeter({ db, peak, clip, note, label, className, size = "sm", showScale }: {
  db: number | null
  peak?: number | null
  clip?: boolean
  /** Replaces the number, e.g. "muted". */
  note?: string
  label?: string
  className?: string
  size?: "sm" | "lg"
  showScale?: boolean
}) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, ((v - MIN) / -MIN) * 100))}%`
  const tone = clip || (db ?? MIN) > -3 ? "bg-destructive" : (db ?? MIN) > -12 ? "bg-warning" : "bg-success"
  const fmt = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1).replace("-", "−"))
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {label && <span className="min-w-4 shrink-0 font-mono text-[11px] text-muted-foreground">{label}</span>}
      <div className="grow">
        <div className={cn("relative overflow-hidden rounded-full bg-muted", size === "lg" ? "h-3" : "h-1.5")}>
          {db != null && <div className={cn("h-full rounded-full", tone)} style={{ width: pct(db) }} />}
          <span className="absolute inset-y-0 w-px bg-foreground/25" style={{ left: pct(-12) }} />
          {peak != null && <span className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: pct(peak) }} />}
        </div>
        {showScale && (
          <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground"><span>−60</span><span>−40</span><span>−20</span><span>−12</span><span>0</span></div>
        )}
      </div>
      <span className={cn("shrink-0 text-right font-mono tabular-nums", size === "lg" ? "w-16 text-lg font-medium" : "w-12 text-xs", clip && "font-semibold text-destructive", (db == null || note) && "text-muted-foreground")}>
        {note ?? (clip ? "CLIP" : fmt(db))}
      </span>
      {peak !== undefined && size === "sm" && <span className="w-12 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">{fmt(peak)}</span>}
    </div>
  )
}
