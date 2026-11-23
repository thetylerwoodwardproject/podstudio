import * as React from "react"
import { Plus } from "lucide-react"

import { AppShell } from "@/components/app-shell"
import { BrandIcon, brandTile } from "@/brand"
import { Badge } from "@/components/ui/badge"
import { SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { useHashRoute } from "@/lib/use-hash-route"
import { cn } from "@/lib/utils"
import { MicPage } from "@/screens/mic"
import { MixPage } from "@/screens/mix"
import { NAV, SESSIONS, type Page } from "@/screens/parts"
import { PublishPage } from "@/screens/publish"
import { RecordingsPage } from "@/screens/recordings"
import { ScriptPage } from "@/screens/script"
import { SessionPage } from "@/screens/session"

export default function App() {
  const [route, navigate] = useHashRoute("session")
  const [recording, setRecording] = React.useState(false)
  const toggle = () => setRecording((r) => !r)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "r") { e.preventDefault(); toggle() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  const page = route.split("/")[0] as Page
  return (
    <AppShell
      brand={{ name: "PodStudio", context: "Episode 42: The Long Show", icon: BrandIcon, tileClassName: brandTile }}
      groups={[{ label: "Studio", items: NAV.map((n) => ({ ...n, badge: n.id === "recordings" ? 3 : undefined })) }]}
      route={route}
      onNavigate={navigate}
      version="2026.11.20-11"
      sidebarTop={
        <SidebarMenuItem>
          <SidebarMenuButton
            onClick={toggle}
            tooltip={recording ? "Stop recording" : "Record"}
            className={cn("mt-1 h-9 border font-medium", recording ? "border-red-500 bg-red-500 text-white hover:bg-red-600 hover:text-white" : "border-red-500/50 bg-red-500/10 hover:bg-red-500/20")}
          >
            <span className={cn("ml-0.5 size-2.5 shrink-0 bg-red-500", recording ? "rounded-[2px] bg-white" : "rounded-full")} />
            <span>{recording ? "Stop recording" : "Record"}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      }
      sidebarExtra={
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
      }
      sidebarStatus={
        <SidebarMenuItem>
          <SidebarMenuButton tooltip="PodMic USB connected"><span className="ml-1 size-2 shrink-0 rounded-full bg-emerald-500" /><span>PodMic USB connected</span></SidebarMenuButton>
        </SidebarMenuItem>
      }
      headerActions={<>
        {recording && <Badge variant="outline" className="border-red-500/40 font-mono text-red-400"><span className="size-1.5 animate-pulse rounded-full bg-red-500" />REC</Badge>}
        <Badge variant="outline" className="hidden border-emerald-500/40 text-emerald-400 sm:inline-flex"><span className="size-1.5 rounded-full bg-emerald-500" />PodMic USB</Badge>
      </>}
    >
      {page === "session" && <SessionPage recording={recording} onRecord={toggle} />}
      {page === "mic" && <MicPage />}
      {page === "mix" && <MixPage />}
      {page === "recordings" && <RecordingsPage />}
      {page === "script" && <ScriptPage />}
      {page === "publish" && <PublishPage />}
    </AppShell>
  )
}
