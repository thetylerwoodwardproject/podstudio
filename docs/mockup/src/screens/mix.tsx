import { Download, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SettingSlider, SwitchRow } from "./parts"

export function MixPage() {
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
