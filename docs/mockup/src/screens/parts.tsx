import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { CircleDot, FileText, Mic, Music, Plus, Send, SlidersHorizontal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Kbd } from "@/components/ui/kbd"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

export type Page = "session" | "mic" | "mix" | "recordings" | "script" | "publish"

export const NAV: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: "session", label: "Session", icon: CircleDot },
  { id: "mic", label: "Mic", icon: Mic },
  { id: "mix", label: "Mix", icon: SlidersHorizontal },
  { id: "recordings", label: "Recordings", icon: Music },
  { id: "script", label: "Script", icon: FileText },
  { id: "publish", label: "Publish", icon: Send },
]

export const SESSIONS = [
  { name: "Episode 42: The Long Show", meta: "Today, 03:12" },
  { name: "Episode 41: Studio Tour", meta: "Nov 14, 41:08" },
  { name: "Episode 40: Listener Mail", meta: "Nov 7, 28:44" },
]

export const PADS = [
  { hk: "1", name: "Intro Music", mode: "One-shot", color: "#ff5c7a", duck: true },
  { hk: "2", name: "Applause", mode: "One-shot", color: "#ffb454" },
  { hk: "3", name: "Rimshot", mode: "One-shot", color: "#f2e35c" },
  { hk: "4", name: "Whoosh", mode: "One-shot", color: "#5cff9d" },
  { hk: "5", name: "Bed Music", mode: "Loop", color: "#4fd8eb", duck: true },
  { hk: "6", name: "Airhorn", mode: "One-shot", color: "#6ea8ff" },
  { hk: "7", name: "Laugh Track", mode: "Hold", color: "#b48bff" },
  { hk: "8", name: "", mode: "", color: "" },
]

/* ---------------------------------------------------------------- live demo levels */
/** Live demo levels in dBFS, with a 2 s peak hold. Feed them to the shared `LevelMeter`. */
export type Levels = { mic: number; hk: number; master: number; peak: { mic: number; hk: number; master: number } }

export function useLevels(active: boolean): Levels {
  const [lv, setLv] = React.useState<Levels>({ mic: -60, hk: -60, master: -60, peak: { mic: -60, hk: -60, master: -60 } })
  const held = React.useRef<Record<"mic" | "hk" | "master", [number, number]>>({ mic: [-60, 0], hk: [-60, 0], master: [-60, 0] })
  React.useEffect(() => {
    let t = 0
    const id = setInterval(() => {
      t++
      const voice = active ? 0.55 + 0.2 * Math.abs(Math.sin(t * 0.37)) * Math.abs(Math.sin(t * 0.11 + 1)) : 0.04
      const hk = 0.25 + 0.15 * Math.abs(Math.sin(t * 0.21))
      const next = { mic: voice, hk, master: Math.min(0.95, voice * 0.85 + hk * 0.25) }
      const db = { mic: -60 + next.mic * 60, hk: -60 + next.hk * 60, master: -60 + next.master * 60 }
      const peak = { mic: 0, hk: 0, master: 0 }
      for (const k of ["mic", "hk", "master"] as const) {
        const [v, at] = held.current[k]
        held.current[k] = db[k] >= v || t - at > 22 ? [db[k], t] : [v, at]
        peak[k] = held.current[k][0]
      }
      setLv({ ...db, peak })
    }, 90)
    return () => clearInterval(id)
  }, [active])
  return lv
}

export function RecordTimer({ recording }: { recording: boolean }) {
  const [ms, setMs] = React.useState(0)
  React.useEffect(() => {
    if (!recording) { setMs(0); return }
    const start = Date.now()
    const id = setInterval(() => setMs(Date.now() - start), 100)
    return () => clearInterval(id)
  }, [recording])
  const s = ms / 1000
  const text = `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(1).padStart(4, "0")}`
  return <div className={cn("font-mono text-5xl tabular-nums tracking-wide", recording ? "text-foreground" : "text-muted-foreground")}>{text}</div>
}

export function Pad({ hk: k, name, mode, color, duck }: { hk: string; name: string; mode: string; color: string; duck?: boolean }) {
  const [hit, setHit] = React.useState(false)
  if (!name) {
    return (
      <button className="flex h-28 flex-col justify-between rounded-xl border border-dashed p-3 text-left text-muted-foreground transition-colors hover:bg-accent/50">
        <Kbd>{k}</Kbd>
        <span className="flex items-center gap-1.5 text-sm"><Plus className="size-4" />Add a sound</span>
      </button>
    )
  }
  return (
    <button
      onClick={() => { setHit(true); setTimeout(() => setHit(false), 350) }}
      className="relative flex h-28 flex-col justify-between overflow-hidden rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent/60"
      style={hit ? { background: `${color}26`, borderColor: color } : undefined}
    >
      <span className="flex items-center justify-between">
        <span className="flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 font-mono text-xs font-medium" style={{ background: `${color}33`, color }}>{k}</span>
        <span className="flex gap-1">
          {duck && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">Duck</Badge>}
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">{mode}</Badge>
        </span>
      </span>
      <span className="pb-1 text-sm font-semibold">{name}</span>
      <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: color }} />
    </button>
  )
}

export function SettingSlider({ label, value, unit, min, max, step = 1, hint }: {
  label: string; value: number; unit: string; min: number; max: number; step?: number; hint?: string
}) {
  const [v, setV] = React.useState([value])
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="font-mono text-xs text-muted-foreground">{v[0]} {unit}</span>
      </div>
      <Slider value={v} onValueChange={setV} min={min} max={max} step={step} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function SwitchRow({ label, hint, defaultChecked }: { label: string; hint?: string; defaultChecked?: boolean }) {
  const id = React.useId()
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
      <div className="grid gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} defaultChecked={defaultChecked} />
    </div>
  )
}

export function fmt(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`
}
