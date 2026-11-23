import { Headphones, Square, Volume2 } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { LevelMeter } from "@/components/level-meter"

/** "Now listening" bar docked under the page: source, L/R meter, volume and Stop. */
export function ListenBar({ source, detail, left, right, extra }: {
  source: string
  detail: string
  left: number
  right: number
  extra?: React.ReactNode
}) {
  const [volume, setVolume] = React.useState([70])
  return (
    <div className="sticky bottom-0 z-10 mx-2 mb-2 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border bg-card px-4 py-3 shadow-sm md:mx-0 md:mb-0 md:rounded-none md:border-x-0 md:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary"><Headphones className="size-4" /></div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-medium">{source}</div>
          <div className="truncate text-xs text-muted-foreground">{detail}</div>
        </div>
      </div>
      <div className="w-56 max-w-full space-y-1">
        <LevelMeter label="L" db={left} />
        <LevelMeter label="R" db={right} />
      </div>
      <div className="flex w-36 items-center gap-2"><Volume2 className="size-4 text-muted-foreground" /><Slider value={volume} onValueChange={setVolume} max={100} /></div>
      {extra}
      <Button variant="outline" size="sm" className="ml-auto"><Square className="fill-current" />Stop</Button>
    </div>
  )
}
