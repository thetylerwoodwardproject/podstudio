import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type Tone = "ok" | "warn" | "bad" | "idle" | "info"

const TONE: Record<Tone, string> = {
  ok: "border-success/30 bg-success/10 text-success",
  warn: "border-warning/30 bg-warning/10 text-warning",
  bad: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-sidebar-primary/30 bg-sidebar-primary/10 text-sidebar-primary dark:text-blue-400",
  idle: "text-muted-foreground",
}
const DOT: Record<Tone, string> = { ok: "bg-success", warn: "bg-warning", bad: "bg-destructive", info: "bg-blue-500", idle: "bg-muted-foreground" }

/** Status as text plus colour, never colour alone. */
export function StatusPill({ tone = "idle", dot = true, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <Badge variant="outline" className={cn(TONE[tone], className)}>
      {dot && <span className={cn("size-1.5 rounded-full", DOT[tone])} />}
      {children}
    </Badge>
  )
}
