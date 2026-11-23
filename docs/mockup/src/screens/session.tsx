import * as React from "react"
import { Mic, Square } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Kbd } from "@/components/ui/kbd"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { LevelMeter } from "@/components/level-meter"
import { PADS, Pad, RecordTimer, useLevels } from "./parts"

/** One mixer channel: name and fader readout, the shared level meter, then the fader and Mute. */
function Channel({ name, dot, db, peak, gain, onGain, muted, onMute }: {
  name: string; dot: string; db: number | null; peak: number | null
  gain: number[]; onGain: (v: number[]) => void; muted: boolean; onMute: () => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium"><span className="size-2 rounded-full" style={{ background: dot }} />{name}</div>
      </div>
      <LevelMeter size="lg" db={db} peak={peak} showScale={name === "Mic"} />
      <div className="flex items-center gap-3">
        <span className="w-10 text-xs text-muted-foreground">Fader</span>
        <Slider min={-60} max={12} step={0.5} value={gain} onValueChange={onGain} />
        <span className="w-16 text-right font-mono text-xs tabular-nums text-muted-foreground">{gain[0].toFixed(1)} dB</span>
        <Button variant={muted ? "destructive" : "outline"} size="sm" className="w-20" onClick={onMute}>{muted ? "Muted" : "Mute"}</Button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- pages */
export function SessionPage({ recording, onRecord }: { recording: boolean; onRecord: () => void }) {
  const lv = useLevels(true)
  const [mic, setMic] = React.useState([0])
  const [hk, setHk] = React.useState([0])
  const [mode, setMode] = React.useState("lufs")
  const [micMute, setMicMute] = React.useState(false)
  const [hkMute, setHkMute] = React.useState(false)
  const lufs = mode === "lufs"
  const masterDb = lufs ? -28 + ((lv.master + 60) / 60) * 14 : -20 + ((lv.master + 60) / 60) * 16
  const masterPeak = lufs ? null : -20 + ((lv.peak.master + 60) / 60) * 16
  const targetPct = `${((-16 + 60) / 60) * 100}%`

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader>
          <CardTitle>Console</CardTitle>
          <CardDescription>Levels in dBFS: green below −12, amber to −3, red above. Double-click a fader to reset it to unity.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <Channel name="Mic" dot="#22d3ee" db={micMute ? null : lv.mic} peak={micMute ? null : lv.peak.mic} gain={mic} onGain={setMic} muted={micMute} onMute={() => setMicMute(!micMute)} />
          <Channel name="Hotkeys" dot="#a78bfa" db={hkMute ? null : lv.hk} peak={hkMute ? null : lv.peak.hk} gain={hk} onGain={setHk} muted={hkMute} onMute={() => setHkMute(!hkMute)} />
          <div className="space-y-3 border-t pt-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium"><span className="size-2 rounded-full bg-foreground" />Master</div>
              <span className="font-mono text-xs text-muted-foreground">{lufs ? "LUFS" : "dBFS"}</span>
            </div>
            <div className="relative">
              <LevelMeter size="lg" db={masterDb} peak={masterPeak} />
              {lufs && (
                <div className="pointer-events-none absolute inset-y-0 left-0 right-[4.5rem]" aria-hidden>
                  <span className="absolute -inset-y-1 w-0.5 rounded-full bg-sky-400" style={{ left: targetPct }} />
                </div>
              )}
            </div>
            <div className="text-xs text-muted-foreground">{lufs ? "Momentary loudness. The blue mark is the −16 LUFS target." : "Peak level of the master."}</div>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
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
