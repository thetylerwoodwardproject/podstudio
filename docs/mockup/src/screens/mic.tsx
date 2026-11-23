import * as React from "react"
import { Mic } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LevelMeter } from "@/components/level-meter"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { SettingSlider, SwitchRow, useLevels } from "./parts"

/* ---------------------------------------------------------------- mic: advanced processing */
export type Knob = { label: string; min: number; max: number; step: number; unit: string; fmt?: (v: number) => string }

export function KnobSlider({ k, value, onChange, disabled }: { k: Knob; value: number; onChange: (v: number) => void; disabled?: boolean }) {
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

export function StageCard({ title, desc, color, on, setOn, graph, children }: {
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
export function TransferCurve({ color, points, threshold }: { color: string; points: [number, number][]; threshold: number }) {
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
export function ToneCurve({ hpf, bottom, exciter }: { hpf: boolean; bottom: { on: boolean; drive: number; tune: number }; exciter: { on: boolean; amt: number; tune: number } }) {
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

export function MicPage() {
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
          <div className="grid items-center gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
            <Label className="text-muted-foreground">Mic level</Label>
            <LevelMeter db={lv.mic} peak={lv.peak.mic} />
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
