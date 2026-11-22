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

function MicPage() {
  const lv = useLevels(true)
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Input</CardTitle>
          <CardDescription>Gain is the mic's own preamp, the same control as Windows' Sound settings.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <SettingSlider label="Input gain" value={42} unit="dB" min={22} max={63} hint="Set it so your loudest speech peaks around -12 dB." />
          <div className="grid gap-2">
            <Label>Level</Label>
            <Progress value={lv.mic * 100} />
          </div>
          <SwitchRow label="Mute" hint="Silences the mic itself" />
          <SwitchRow label="High-pass filter" hint="Cuts rumble below 75 Hz" defaultChecked />
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
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>On-board processing</CardTitle>
          <CardDescription>Runs inside the PodMic, so it is in every app, not just PodStudio.</CardDescription>
          <CardAction>
            <ToggleGroup type="single" variant="outline" size="sm" defaultValue="basic">
              <ToggleGroupItem value="basic">Basic</ToggleGroupItem>
              <ToggleGroupItem value="advanced">Advanced</ToggleGroupItem>
            </ToggleGroup>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-3">
          <SettingSlider label="Depth" value={50} unit="%" min={0} max={100} hint="Low-end warmth." />
          <SettingSlider label="Sparkle" value={40} unit="%" min={0} max={100} hint="High-end clarity." />
          <SettingSlider label="Punch" value={60} unit="%" min={0} max={100} hint="Compression." />
        </CardContent>
      </Card>
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
