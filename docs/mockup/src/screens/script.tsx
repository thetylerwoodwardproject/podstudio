import { Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { SettingSlider, SwitchRow } from "./parts"

export function ScriptPage() {
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
