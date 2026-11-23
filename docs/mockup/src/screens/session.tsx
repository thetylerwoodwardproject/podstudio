import * as React from "react"
import { Mic, Square } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Kbd } from "@/components/ui/kbd"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { PADS, Pad, RecordTimer, Strip, useLevels } from "./parts"

/* ---------------------------------------------------------------- pages */
export function SessionPage({ recording, onRecord }: { recording: boolean; onRecord: () => void }) {
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
