import { Upload } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { SwitchRow } from "./parts"

export function PublishPage() {
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
