import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/** shadcn "section cards" tile: label, big value, optional icon and a footer line. */
export function StatCard({ label, value, icon: Icon, footer, tone }: {
  label: string
  value: React.ReactNode
  icon?: LucideIcon
  footer?: React.ReactNode
  tone?: "ok" | "warn" | "bad"
}) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="gap-1 px-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={cn("text-2xl font-semibold tabular-nums", tone === "ok" && "text-success", tone === "warn" && "text-warning", tone === "bad" && "text-destructive")}>
          {value}
        </CardTitle>
        {Icon && <CardAction><Icon className="size-4 text-muted-foreground" /></CardAction>}
      </CardHeader>
      {footer && <CardFooter className="px-4 text-xs text-muted-foreground">{footer}</CardFooter>}
    </Card>
  )
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
}
