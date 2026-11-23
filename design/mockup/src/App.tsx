import * as React from "react"
import {
  AudioLines,
  ChevronsUpDown,
  CircleDot,
  Download,
  FileText,
  Info,
  Mic,
  Music,
  Play,
  Plus,
  RefreshCw,
  Send,
  SlidersHorizontal,
  Square,
  Upload,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

type Page = "session" | "mic" | "mix" | "recordings" | "script" | "publish"

const NAV: { id: Page; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "session", label: "Session", icon: CircleDot },
  { id: "mic", label: "Mic", icon: Mic },
  { id: "mix", label: "Mix", icon: SlidersHorizontal },
  { id: "recordings", label: "Recordings", icon: Music },
  { id: "script", label: "Script", icon: FileText },
  { id: "publish", label: "Publish", icon: Send },
]

const SESSIONS = [
  { name: "Episode 42: The Long Show", meta: "Today, 03:12" },
  { name: "Episode 41: Studio Tour", meta: "Nov 14, 41:08" },
  { name: "Episode 40: Listener Mail", meta: "Nov 7, 28:44" },
]

const PADS = [
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
function useLevels(active: boolean) {
  const [t, setT] = React.useState(0)
  React.useEffect(() => {
    const id = setInterval(() => setT((v) => v + 1), 90)
    return () => clearInterval(id)
  }, [])
  const voice = active ? 0.55 + 0.2 * Math.abs(Math.sin(t * 0.37)) * Math.abs(Math.sin(t * 0.11 + 1)) : 0.04
  const hk = 0.25 + 0.15 * Math.abs(Math.sin(t * 0.21))
  return { mic: voice, hk, master: Math.min(0.95, voice * 0.85 + hk * 0.25) }
}

function Meter({ value, target }: { value: number; target?: number }) {
  const n = 30
  return (
    <div className="relative flex h-48 w-3 flex-col-reverse gap-[2px]">
      {Array.from({ length: n }, (_, i) => {
        const p = (i + 1) / n
        const on = p <= value
        return (
          <div
            key={i}
            className={cn(
              "flex-1 rounded-[1px] transition-colors duration-75",
              !on && "bg-muted",
              on && p <= 0.78 && "bg-emerald-500",
              on && p > 0.78 && p <= 0.93 && "bg-amber-500",
              on && p > 0.93 && "bg-red-500"
            )}
          />
        )
      })}
      {target !== undefined && (
        <div className="absolute -inset-x-1 h-0.5 bg-sky-400" style={{ bottom: `${target * 100}%` }} />
      )}
    </div>
  )
}

function Ruler() {
  return (
    <div className="flex h-48 flex-col justify-between text-right font-mono text-[10px] text-muted-foreground">
      <span>0</span><span>-12</span><span>-24</span><span>-36</span><span>-48</span>
    </div>
  )
}

function Strip({ name, dot, value, children, readout, caption }: {
  name: string; dot: string; value: number; children?: React.ReactNode; readout: string; caption?: string
}) {
  return (
    <div className="flex min-w-36 flex-col items-center gap-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="size-2 rounded-full" style={{ background: dot }} />
        {name}
      </div>
      <div className="font-mono text-xs text-muted-foreground">{readout}</div>
      {caption && <div className="-mt-1 text-[11px] text-muted-foreground">{caption}</div>}
      <div className="flex items-stretch gap-3 pt-1">
        <Ruler />
        <Meter value={value} target={name === "Master" ? 0.73 : undefined} />
        {children}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- pages */
function SessionPage({ recording, onRecord }: { recording: boolean; onRecord: () => void }) {
  const lv = useLevels(true)
  const [mic, setMic] = React.useState([0])
  const [hk, setHk] = React.useState([0])
  const [mode, setMode] = React.useState("lufs")
  const [micMute, setMicMute] = React.useState(false)
  const [hkMute, setHkMute] = React.useState(false)
  const masterDb = mode === "lufs" ? `${(-28 + lv.master * 14).toFixed(1)} LUFS` : `${(-20 + lv.master * 16).toFixed(1)} dBFS`

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader>
          <CardTitle>Console</CardTitle>
          <CardDescription>Levels in dBFS. Double-click a fader to reset it to unity.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap justify-around gap-6">
          <Strip name="Mic" dot="#22d3ee" value={micMute ? 0 : lv.mic} readout={`${mic[0].toFixed(1)} dB`}>
            <Slider orientation="vertical" min={-60} max={12} step={0.5} value={mic} onValueChange={setMic} className="!min-h-0 h-48" />
          </Strip>
          <Strip name="Hotkeys" dot="#a78bfa" value={hkMute ? 0 : lv.hk} readout={`${hk[0].toFixed(1)} dB`}>
            <Slider orientation="vertical" min={-60} max={12} step={0.5} value={hk} onValueChange={setHk} className="!min-h-0 h-48" />
          </Strip>
          <Strip name="Master" dot="#fafafa" value={lv.master} readout={masterDb}
            caption={mode === "lufs" ? "momentary, target -16" : "peak"} />
        </CardContent>
        <CardFooter className="flex flex-wrap justify-around gap-6">
          <Button variant={micMute ? "destructive" : "outline"} size="sm" className="w-24" onClick={() => setMicMute(!micMute)}>
            {micMute ? "Muted" : "Mute"}
          </Button>
          <Button variant={hkMute ? "destructive" : "outline"} size="sm" className="w-24" onClick={() => setHkMute(!hkMute)}>
            {hkMute ? "Muted" : "Mute"}
          </Button>
          <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(v) => v && setMode(v)}>
            <ToggleGroupItem value="lufs">LUFS</ToggleGroupItem>
            <ToggleGroupItem value="peak">dBFS</ToggleGroupItem>
          </ToggleGroup>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recorder</CardTitle>
          <CardDescription>48 kHz, 24-bit, mono</CardDescription>
          <CardAction>
            <Badge variant="outline" className={cn(recording ? "border-red-500/40 text-red-400" : "border-emerald-500/40 text-emerald-400")}>
              <span className={cn("size-1.5 rounded-full", recording ? "bg-red-500 animate-pulse" : "bg-emerald-500")} />
              {recording ? "Recording" : "Ready"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col items-center justify-center gap-5 py-4">
          <RecordTimer recording={recording} />
          <button
            onClick={onRecord}
            aria-label={recording ? "Stop" : "Record"}
            className={cn(
              "flex size-24 items-center justify-center rounded-full border-[3px] transition-colors",
              recording ? "border-red-500" : "border-muted-foreground/60 hover:border-foreground"
            )}
          >
            <span className={cn("bg-red-500 transition-all", recording ? "size-8 rounded-md" : "size-14 rounded-full")} />
          </button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {recording ? "Stop" : "Record"} <Kbd>Ctrl</Kbd><Kbd>R</Kbd>
          </div>
        </CardContent>
        <CardFooter className="justify-between border-t text-xs text-muted-foreground">
          <span>Ducking</span>
          <span className="font-mono text-foreground">-12 dB</span>
        </CardFooter>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Hotkeys</CardTitle>
          <CardDescription>Press a pad's key or click it. Right-click a pad to edit it.</CardDescription>
          <CardAction><Button variant="outline" size="sm"><Square />Stop sounds</Button></CardAction>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {PADS.map((p) => <Pad key={p.hk} {...p} />)}
        </CardContent>
      </Card>
    </div>
  )
}

function RecordTimer({ recording }: { recording: boolean }) {
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

function Pad({ hk: k, name, mode, color, duck }: { hk: string; name: string; mode: string; color: string; duck?: boolean }) {
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

function SettingSlider({ label, value, unit, min, max, step = 1, hint }: {
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

function SwitchRow({ label, hint, defaultChecked }: { label: string; hint?: string; defaultChecked?: boolean }) {
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

/* ---------------------------------------------------------------- mic: advanced processing */
type Knob = { label: string; min: number; max: number; step: number; unit: string; fmt?: (v: number) => string }

function KnobSlider({ k, value, onChange, disabled }: { k: Knob; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const text = k.fmt ? k.fmt(value) : `${value} ${k.unit}`
  return (
    <div className={cn("grid gap-2.5", disabled && "opacity-50")}>
      <div className="flex items-center justify-between">
        <Label className="text-[13px]">{k.label}</Label>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{text}</span>
      </div>
      <Slider value={[value]} min={k.min} max={k.max} step={k.step} disabled={disabled} onValueChange={(v) => onChange(v[0])} />
    </div>
  )
}

function StageCard({ title, desc, color, on, setOn, graph, children }: {
  title: string; desc: string; color: string; on: boolean; setOn: (v: boolean) => void; graph: React.ReactNode; children: React.ReactNode
}) {
  return (
    <Card className={cn("gap-5", !on && "opacity-80")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: color }} />{title}</CardTitle>
        <CardDescription>{desc}</CardDescription>
        <CardAction><Switch checked={on} onCheckedChange={setOn} aria-label={`${title} on`} /></CardAction>
      </CardHeader>
      <CardContent className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="flex items-center rounded-lg border bg-muted/20 p-2">{graph}</div>
        <div className="grid content-start gap-4">{children}</div>
      </CardContent>
    </Card>
  )
}

/* input/output curve for the compressor and the gate, drawn from the settings */
function TransferCurve({ color, points, threshold }: { color: string; points: [number, number][]; threshold: number }) {
  const W = 200, H = 160, lo = -60
  const x = (db: number) => ((db - lo) / -lo) * W
  const y = (db: number) => H - ((Math.max(lo, db) - lo) / -lo) * H
  const d = points.map(([i, o], n) => `${n ? "L" : "M"}${x(i).toFixed(1)},${y(o).toFixed(1)}`).join(" ")
  return (
    <svg viewBox={`-28 -6 ${W + 34} ${H + 26}`} className="w-full" role="img" aria-label="Input to output curve">
      {[-48, -36, -24, -12].map((g) => (
        <g key={g}>
          <line x1={x(g)} y1={0} x2={x(g)} y2={H} className="stroke-border" />
          <line x1={0} y1={y(g)} x2={W} y2={y(g)} className="stroke-border" />
          <text x={-4} y={y(g) + 3} textAnchor="end" className="fill-muted-foreground font-mono text-[8px]">{g}</text>
        </g>
      ))}
      <rect x={0} y={0} width={W} height={H} fill="none" className="stroke-border" />
      <line x1={0} y1={H} x2={W} y2={0} className="stroke-muted-foreground/40" strokeDasharray="3 3" />
      <line x1={x(threshold)} y1={0} x2={x(threshold)} y2={H} stroke={color} strokeOpacity={0.5} strokeDasharray="2 3" />
      <path d={d} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
      <text x={W / 2} y={H + 16} textAnchor="middle" className="fill-muted-foreground text-[8px]">Input (dB)</text>
    </svg>
  )
}

/* combined tone curve of the high-pass filter, Big Bottom and Aural Exciter, drawn from the settings */
function ToneCurve({ hpf, bottom, exciter }: { hpf: boolean; bottom: { on: boolean; drive: number; tune: number }; exciter: { on: boolean; amt: number; tune: number } }) {
  const W = 460, H = 150, fLo = 20, fHi = 20000
  const fx = (f: number) => (Math.log10(f / fLo) / Math.log10(fHi / fLo)) * W
  const gy = (db: number) => H / 2 - db * (H / 2 / 12)
  const pts: string[] = []
  for (let i = 0; i <= 160; i++) {
    const f = fLo * Math.pow(fHi / fLo, i / 160)
    let g = 0
    if (hpf) g += -10 * Math.log10(1 + Math.pow(75 / f, 4))
    if (bottom.on) g += (bottom.drive / 100) * 8 * Math.exp(-Math.pow(Math.log2(f / bottom.tune), 2) / 0.9)
    if (exciter.on) g += (exciter.amt / 100) * 6 / (1 + Math.pow(exciter.tune / f, 2))
    pts.push(`${i ? "L" : "M"}${fx(f).toFixed(1)},${gy(Math.max(-12, Math.min(12, g))).toFixed(1)}`)
  }
  const ticks = [50, 100, 200, 500, 1000, 2000, 5000, 10000]
  return (
    <svg viewBox={`-26 -6 ${W + 32} ${H + 26}`} className="w-full" role="img" aria-label="Tone curve">
      {ticks.map((f) => (
        <g key={f}>
          <line x1={fx(f)} y1={0} x2={fx(f)} y2={H} className="stroke-border" />
          <text x={fx(f)} y={H + 14} textAnchor="middle" className="fill-muted-foreground font-mono text-[8px]">{f >= 1000 ? `${f / 1000}k` : f}</text>
        </g>
      ))}
      {[-12, -6, 0, 6, 12].map((g) => (
        <g key={g}>
          <line x1={0} y1={gy(g)} x2={W} y2={gy(g)} className={g === 0 ? "stroke-muted-foreground/50" : "stroke-border"} />
          <text x={-4} y={gy(g) + 3} textAnchor="end" className="fill-muted-foreground font-mono text-[8px]">{g > 0 ? `+${g}` : g}</text>
        </g>
      ))}
      {bottom.on && <line x1={fx(bottom.tune)} y1={0} x2={fx(bottom.tune)} y2={H} stroke="#ff7ad9" strokeOpacity={0.45} strokeDasharray="2 3" />}
      {exciter.on && <line x1={fx(exciter.tune)} y1={0} x2={fx(exciter.tune)} y2={H} stroke="#b48bff" strokeOpacity={0.45} strokeDasharray="2 3" />}
      <path d={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth={2.2} className="text-foreground" />
    </svg>
  )
}

function MicPage() {
  const lv = useLevels(true)
  const [mode, setMode] = React.useState("advanced")
  const [hpf, setHpf] = React.useState(true)
  const [gateOn, setGateOn] = React.useState(true)
  const [compOn, setCompOn] = React.useState(true)
  const [excOn, setExcOn] = React.useState(true)
  const [botOn, setBotOn] = React.useState(true)
  const [gate, setGate] = React.useState({ threshold: -45, range: -13, attack: 1, hold: 0.25, release: 0.35, hysteresis: 30 })
  const [comp, setComp] = React.useState({ threshold: -22, ratio: 3, attack: 2.5, release: 80, gain: 4.5 })
  const [exc, setExc] = React.useState({ amt: 40, tune: 2800 })
  const [bot, setBot] = React.useState({ drive: 45, tune: 110 })

  const compPts: [number, number][] = []
  for (let i = -60; i <= 0; i += 1) {
    const o = i <= comp.threshold ? i : comp.threshold + (i - comp.threshold) / comp.ratio
    compPts.push([i, Math.min(0, o + comp.gain)])
  }
  const gatePts: [number, number][] = []
  for (let i = -60; i <= 0; i += 1) gatePts.push([i, i < gate.threshold ? i + gate.range : i])

  const chain = [
    { name: "High-pass", on: hpf, set: setHpf, color: "#a1a1aa" },
    { name: "Noise gate", on: gateOn, set: setGateOn, color: "#4fd8eb" },
    { name: "Compressor", on: compOn, set: setCompOn, color: "#ffb454" },
    { name: "Aural Exciter", on: excOn, set: setExcOn, color: "#b48bff" },
    { name: "Big Bottom", on: botOn, set: setBotOn, color: "#ff7ad9" },
  ]

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>On-board processing</CardTitle>
          <CardDescription>Runs inside the PodMic, so it's in every app, not just PodStudio. Settings stay in the mic when you unplug it.</CardDescription>
          <CardAction>
            <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(v) => v && setMode(v)}>
              <ToggleGroupItem value="basic">Basic</ToggleGroupItem>
              <ToggleGroupItem value="advanced">Advanced</ToggleGroupItem>
            </ToggleGroup>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {chain.map((c) => (
              <React.Fragment key={c.name}>
                <Button variant="outline" size="sm" onClick={() => c.set(!c.on)} aria-pressed={c.on}
                  className={cn("gap-2", !c.on && "text-muted-foreground line-through decoration-muted-foreground/60")}>
                  <span className="size-2 rounded-full" style={{ background: c.on ? c.color : "transparent", border: `1.5px solid ${c.color}` }} />
                  {c.name}
                </Button>
              </React.Fragment>
            ))}
            <span className="text-xs text-muted-foreground">Click a stage to turn it on or off.</span>
          </div>
          <div className="grid items-center gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <Label className="text-muted-foreground">Mic level</Label>
            <Progress value={lv.mic * 100} />
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{(-60 + lv.mic * 60).toFixed(1)} dBFS</span>
          </div>
        </CardContent>
      </Card>

      {mode === "basic" ? (
        <Card>
          <CardHeader>
            <CardTitle>Basic</CardTitle>
            <CardDescription>Three simple controls. Advanced shows every setting behind them.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-3">
            <SettingSlider label="Depth" value={50} unit="%" min={0} max={100} hint="Low-end warmth (Big Bottom)." />
            <SettingSlider label="Sparkle" value={40} unit="%" min={0} max={100} hint="High-end clarity (Aural Exciter)." />
            <SettingSlider label="Punch" value={60} unit="%" min={0} max={100} hint="Compression and gate." />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Tone</CardTitle>
              <CardDescription>The combined shape of the high-pass filter, Big Bottom and Aural Exciter.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="flex items-center rounded-lg border bg-muted/20 p-3">
                <ToneCurve hpf={hpf} bottom={{ on: botOn, ...bot }} exciter={{ on: excOn, ...exc }} />
              </div>
              <div className="grid content-start gap-5">
                <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <div className="grid gap-0.5"><Label htmlFor="hpf">High-pass filter</Label><p className="text-xs text-muted-foreground">Cuts rumble below 75 Hz</p></div>
                  <Switch id="hpf" checked={hpf} onCheckedChange={setHpf} />
                </div>
                <div className="grid gap-4">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-medium"><span className="size-2 rounded-full bg-[#ff7ad9]" />Big Bottom</span>
                    <Switch checked={botOn} onCheckedChange={setBotOn} aria-label="Big Bottom on" />
                  </div>
                  <KnobSlider disabled={!botOn} k={{ label: "Drive", min: 0, max: 100, step: 1, unit: "%" }} value={bot.drive} onChange={(v) => setBot({ ...bot, drive: v })} />
                  <KnobSlider disabled={!botOn} k={{ label: "Tune", min: 60, max: 312, step: 1, unit: "Hz" }} value={bot.tune} onChange={(v) => setBot({ ...bot, tune: v })} />
                </div>
                <Separator />
                <div className="grid gap-4">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-medium"><span className="size-2 rounded-full bg-[#b48bff]" />Aural Exciter</span>
                    <Switch checked={excOn} onCheckedChange={setExcOn} aria-label="Aural Exciter on" />
                  </div>
                  <KnobSlider disabled={!excOn} k={{ label: "Harmonics", min: 0, max: 100, step: 1, unit: "%" }} value={exc.amt} onChange={(v) => setExc({ ...exc, amt: v })} />
                  <KnobSlider disabled={!excOn} k={{ label: "Tune", min: 600, max: 5000, step: 10, unit: "Hz", fmt: (v) => v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${v} Hz` }} value={exc.tune} onChange={(v) => setExc({ ...exc, tune: v })} />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <StageCard title="Compressor" desc="Evens out loud and quiet speech." color="#ffb454" on={compOn} setOn={setCompOn}
              graph={<TransferCurve color="#ffb454" points={compPts} threshold={comp.threshold} />}>
              <KnobSlider disabled={!compOn} k={{ label: "Threshold", min: -60, max: 0, step: 0.5, unit: "dB" }} value={comp.threshold} onChange={(v) => setComp({ ...comp, threshold: v })} />
              <KnobSlider disabled={!compOn} k={{ label: "Ratio", min: 1.5, max: 4.5, step: 0.05, unit: "", fmt: (v) => `${v.toFixed(2)} : 1` }} value={comp.ratio} onChange={(v) => setComp({ ...comp, ratio: v })} />
              <div className="grid gap-4 sm:grid-cols-2">
                <KnobSlider disabled={!compOn} k={{ label: "Attack", min: 0.1, max: 10, step: 0.1, unit: "ms" }} value={comp.attack} onChange={(v) => setComp({ ...comp, attack: v })} />
                <KnobSlider disabled={!compOn} k={{ label: "Release", min: 5, max: 200, step: 1, unit: "ms" }} value={comp.release} onChange={(v) => setComp({ ...comp, release: v })} />
              </div>
              <KnobSlider disabled={!compOn} k={{ label: "Make-up gain", min: 0, max: 9, step: 0.1, unit: "dB" }} value={comp.gain} onChange={(v) => setComp({ ...comp, gain: v })} />
            </StageCard>

            <StageCard title="Noise gate" desc="Quietens the room between phrases." color="#4fd8eb" on={gateOn} setOn={setGateOn}
              graph={<TransferCurve color="#4fd8eb" points={gatePts} threshold={gate.threshold} />}>
              <div className="grid gap-4 sm:grid-cols-2">
                <KnobSlider disabled={!gateOn} k={{ label: "Threshold", min: -60, max: 0, step: 0.5, unit: "dB" }} value={gate.threshold} onChange={(v) => setGate({ ...gate, threshold: v })} />
                <KnobSlider disabled={!gateOn} k={{ label: "Range", min: -100, max: 0, step: 1, unit: "dB" }} value={gate.range} onChange={(v) => setGate({ ...gate, range: v })} />
                <KnobSlider disabled={!gateOn} k={{ label: "Attack", min: 0.1, max: 1000, step: 0.1, unit: "ms" }} value={gate.attack} onChange={(v) => setGate({ ...gate, attack: v })} />
                <KnobSlider disabled={!gateOn} k={{ label: "Hold", min: 0.05, max: 2, step: 0.01, unit: "s" }} value={gate.hold} onChange={(v) => setGate({ ...gate, hold: v })} />
                <KnobSlider disabled={!gateOn} k={{ label: "Release", min: 0.05, max: 2, step: 0.01, unit: "s" }} value={gate.release} onChange={(v) => setGate({ ...gate, release: v })} />
                <KnobSlider disabled={!gateOn} k={{ label: "Hysteresis", min: 0, max: 100, step: 1, unit: "%" }} value={gate.hysteresis} onChange={(v) => setGate({ ...gate, hysteresis: v })} />
              </div>
            </StageCard>
          </div>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Input</CardTitle>
            <CardDescription>Gain is the mic's own preamp, the same control as Windows' Sound settings.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <SettingSlider label="Input gain" value={42} unit="dB" min={22} max={63} hint="Set it so your loudest speech peaks around -12 dB." />
            <SwitchRow label="Mute" hint="Silences the mic itself" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Headphones</CardTitle>
            <CardDescription>Direct monitoring plays your mic in the headphone jack with no delay.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <SwitchRow label="Direct monitoring" defaultChecked />
            <SettingSlider label="Monitor mix" value={91} unit="%" min={0} max={100} hint="Left: more mic. Right: more computer audio." />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MixPage() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Master</CardTitle>
          <CardDescription>Stereo, normalized to the loudness target with a true-peak limit.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <SettingSlider label="Loudness target" value={-16} unit="LUFS" min={-30} max={-6} hint="Podcasts are usually -16 LUFS. Louder than -14 may be turned down by players." />
          <SwitchRow label="Mute hotkeys in the master" hint="Sounds stay live, but are left out of the render." />
          <div className="flex justify-between text-xs text-muted-foreground"><span>True-peak ceiling</span><span className="font-mono text-foreground">-1.0 dBTP, 4x oversampled</span></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Noise reduction</CardTitle>
          <CardDescription>DeepFilterNet cleans the mic when the master is rendered. Your raw mic is never changed.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <SwitchRow label="Reduce background noise" defaultChecked />
          <SettingSlider label="Strength" value={18} unit="dB" min={0} max={50} hint="Higher removes more, and can sound processed." />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Ducking</CardTitle>
          <CardDescription>Pads set to duck dip under your voice, live and in the master.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <SettingSlider label="Dip" value={12} unit="dB" min={0} max={40} />
          <SettingSlider label="Voice threshold" value={-40} unit="dB" min={-60} max={-20} />
          <SettingSlider label="Release" value={350} unit="ms" min={50} max={2000} step={10} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Render master</CardTitle>
          <CardDescription>Mix, clean up, normalize and export.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Button><RefreshCw />Render master</Button>
            <Button variant="outline"><Download />Export MP3</Button>
            <Button variant="ghost">Show files</Button>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-sm font-medium">Master ready</div>
            <div className="mt-1 font-mono text-xs text-muted-foreground">-16.0 LUFS, -1.2 dBTP, 3 min 12 s</div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function RecordingsPage() {
  const bars = React.useMemo(() => Array.from({ length: 140 }, (_, i) => {
    const a = Math.abs(Math.sin(i * 0.17)) * 0.55 + Math.abs(Math.sin(i * 0.61 + 1)) * 0.3
    return Math.max(0.04, a * (i % 46 > 39 ? 0.12 : 1))
  }), [])
  const [pos, setPos] = React.useState(0.34)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Episode 42: The Long Show</CardTitle>
        <CardDescription className="font-mono">2026-11-21 10:01:48</CardDescription>
        <CardAction>
          <ToggleGroup type="single" variant="outline" size="sm" defaultValue="master">
            <ToggleGroupItem value="master">Master</ToggleGroupItem>
            <ToggleGroupItem value="mic">Mic</ToggleGroupItem>
            <ToggleGroupItem value="hotkeys">Hotkeys</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        <button
          className="relative flex h-56 items-center gap-[2px] rounded-lg border bg-muted/30 px-3"
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPos((e.clientX - r.left) / r.width) }}
          aria-label="Waveform: click to jump"
        >
          {bars.map((h, i) => (
            <span key={i} className={cn("flex-1 rounded-full", i / bars.length < pos ? "bg-foreground" : "bg-muted-foreground/40")} style={{ height: `${h * 92}%` }} />
          ))}
          <span className="absolute inset-y-0 w-0.5 bg-red-500" style={{ left: `${pos * 100}%` }} />
        </button>
        <div className="flex flex-wrap items-center gap-4">
          <Button size="icon" className="size-11 rounded-full" aria-label="Play"><Play className="fill-current" /></Button>
          <span className="font-mono text-sm">{fmt(pos * 192)} <span className="text-muted-foreground">/ 03:12</span></span>
          <Slider className="min-w-40 flex-1" value={[pos * 100]} onValueChange={(v) => setPos(v[0] / 100)} />
          <Button variant="outline"><Plus />Add chapter here</Button>
        </div>
        <p className="text-xs text-muted-foreground">Space plays and pauses. Left and Right skip 5 seconds. Click the waveform to jump.</p>
        <Separator />
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Chapters</h3>
          {[["00:00", "Cold open"], ["00:48", "Why the long show"], ["02:15", "Listener question"]].map(([t, n]) => (
            <div key={t} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
              <span className="w-12 font-mono text-xs text-muted-foreground">{t}</span>{n}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function fmt(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`
}

function ScriptPage() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <Card>
        <CardHeader>
          <CardTitle>Script</CardTitle>
          <CardDescription>Saved with the session. Press F8 to start the prompter.</CardDescription>
          <CardAction><Button variant="outline" size="sm"><Play />Prompter</Button></CardAction>
        </CardHeader>
        <CardContent>
          <Textarea className="min-h-96 text-base leading-relaxed" defaultValue={"Cold open\n\nWelcome back to The Long Show. We run long on purpose, and today is no exception.\n\nWhy the long show\n\nA listener asked why we don't cut it down to twenty minutes. Here's the honest answer..."} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Prompter</CardTitle>
          <CardDescription>Scroll speed and start.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <SettingSlider label="Speed" value={120} unit="wpm" min={60} max={220} />
          <SwitchRow label="Start when recording" defaultChecked />
        </CardContent>
      </Card>
    </div>
  )
}

function PublishPage() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader>
          <CardTitle>Episode details</CardTitle>
          <CardDescription>Saved with the session. Uploaded as a private draft.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2"><Label htmlFor="t">Title</Label><Input id="t" defaultValue="Episode 42: The Long Show" /></div>
          <div className="grid gap-2">
            <Label htmlFor="d">Description</Label>
            <Textarea id="d" rows={4} defaultValue="We run long on purpose. Gear we tried this month, a listener question that turned into a rant, and what we'd do differently next time." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2"><Label htmlFor="s">Season</Label><Input id="s" defaultValue="2" className="font-mono" /></div>
            <div className="grid gap-2"><Label htmlFor="e">Episode number</Label><Input id="e" defaultValue="42" className="font-mono" /></div>
          </div>
          <SwitchRow label="Explicit" hint="Mark the episode as containing explicit language." />
        </CardContent>
      </Card>
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Buzzsprout</CardTitle>
            <CardDescription>Your token is kept in Windows Credential Manager.</CardDescription>
            <CardAction><Badge variant="outline" className="border-emerald-500/40 text-emerald-400"><span className="size-1.5 rounded-full bg-emerald-500" />Connected</Badge></CardAction>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Label>Podcast</Label>
            <Select defaultValue="long">
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="long">The Long Show</SelectItem>
                <SelectItem value="short">The Short Show</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ready to upload</CardTitle>
            <CardDescription>Master, chapters and cover art go up together.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {[["Master (-16.0 LUFS)", "3 min 12 s"], ["MP3 (128 kbps)", "3.0 MB"], ["Chapters", "3"]].map(([a, b]) => (
              <div key={a} className="flex justify-between"><span>{a}</span><span className="font-mono text-xs text-muted-foreground">{b}</span></div>
            ))}
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-2">
            <Button><Upload />Upload private draft</Button>
            <p className="text-xs text-muted-foreground">Nothing goes public until you publish it in Buzzsprout.</p>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- shell */
function AppSidebar({ page, setPage, recording, onRecord }: {
  page: Page; setPage: (p: Page) => void; recording: boolean; onRecord: () => void
}) {
  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="PodStudio">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <AudioLines className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">PodStudio</span>
                <span className="truncate text-xs text-muted-foreground">Episode 42: The Long Show</span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={onRecord}
              tooltip={recording ? "Stop recording" : "Record"}
              className={cn(
                "mt-1 h-9 border font-medium",
                recording
                  ? "border-red-500 bg-red-500 text-white hover:bg-red-600 hover:text-white"
                  : "border-red-500/50 bg-red-500/10 hover:bg-red-500/20"
              )}
            >
              <span className={cn("ml-0.5 size-2.5 shrink-0 bg-red-500", recording ? "rounded-[2px] bg-white" : "rounded-full")} />
              <span>{recording ? "Stop recording" : "Record"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Studio</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((n) => (
                <SidebarMenuItem key={n.id}>
                  <SidebarMenuButton isActive={page === n.id} tooltip={n.label} onClick={() => setPage(n.id)}>
                    <n.icon />
                    <span>{n.label}</span>
                  </SidebarMenuButton>
                  {n.id === "recordings" && <SidebarMenuBadge>3</SidebarMenuBadge>}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Sessions</SidebarGroupLabel>
          <SidebarGroupAction title="New session"><Plus /></SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {SESSIONS.map((s, i) => (
                <SidebarMenuItem key={s.name}>
                  <SidebarMenuButton isActive={i === 0} className="h-auto py-2">
                    <div className="grid min-w-0 leading-tight">
                      <span className="truncate">{s.name}</span>
                      <span className="truncate font-mono text-[11px] text-muted-foreground">{s.meta}</span>
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="PodMic USB connected">
              <span className="ml-1 size-2 shrink-0 rounded-full bg-emerald-500" />
              <span>PodMic USB connected</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="About PodStudio">
              <Info />
              <span>About</span>
              <Badge variant="secondary" className="ml-auto h-5 text-[10px]">2026.11.20-11</Badge>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

export default function App() {
  const [page, setPage] = React.useState<Page>("session")
  const [recording, setRecording] = React.useState(false)
  const toggle = () => setRecording((r) => !r)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "r") { e.preventDefault(); toggle() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  const label = NAV.find((n) => n.id === page)!.label

  return (
    <SidebarProvider>
      <AppSidebar page={page} setPage={setPage} recording={recording} onRecord={toggle} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block"><BreadcrumbLink href="#">Episode 42: The Long Show</BreadcrumbLink></BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem><BreadcrumbPage>{label}</BreadcrumbPage></BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-2">
            {recording && (
              <Badge variant="outline" className="border-red-500/40 font-mono text-red-400">
                <span className="size-1.5 animate-pulse rounded-full bg-red-500" />REC
              </Badge>
            )}
            <Badge variant="outline" className="hidden border-emerald-500/40 text-emerald-400 sm:inline-flex">
              <span className="size-1.5 rounded-full bg-emerald-500" />PodMic USB
            </Badge>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">
          {page === "session" && <SessionPage recording={recording} onRecord={toggle} />}
          {page === "mic" && <MicPage />}
          {page === "mix" && <MixPage />}
          {page === "recordings" && <RecordingsPage />}
          {page === "script" && <ScriptPage />}
          {page === "publish" && <PublishPage />}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
