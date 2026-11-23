import * as React from "react"
import { Mic, Play, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

export function RecordingsPage() {
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

import { fmt } from "./parts"
