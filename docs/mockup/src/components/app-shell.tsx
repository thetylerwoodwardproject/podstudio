import * as React from "react"
import { ChevronsUpDown, Info, type LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { cn } from "@/lib/utils"

export type NavItem = {
  id: string
  label: string
  icon: LucideIcon
  badge?: string | number
}
export type NavGroup = { label: string; items: NavItem[] }

export type AppShellProps = {
  /** Product name, a one-line context under it (host, project, session) and its icon. */
  brand: { name: string; context: string; icon: LucideIcon; /** Classes for the tile behind the icon, to give each app its own colour. */ tileClassName?: string }
  groups: NavGroup[]
  /** Current hash route, e.g. "stations" or "station/kut-hd". The first segment picks the active nav item. */
  route: string
  onNavigate: (route: string) => void
  /** Extra crumb for detail pages, shown after the page name. */
  crumb?: string
  /** Under the brand, e.g. PodStudio's Record button. */
  sidebarTop?: React.ReactNode
  /** Extra sidebar groups after the nav, hidden when the sidebar is collapsed. */
  sidebarExtra?: React.ReactNode
  /** Status rows above the version row (connection, disk, services). */
  sidebarStatus?: React.ReactNode
  version: string
  headerActions?: React.ReactNode
  /** Hide the System/Light/Dark switch for dark-only products. */
  showThemeToggle?: boolean
  /** Docked under the page, e.g. a "Now listening" bar. */
  bottomBar?: React.ReactNode
  children: React.ReactNode
}

/**
 * The frame every mockup shares: shadcn inset sidebar (brand, nav groups, status, version), a header
 * with breadcrumb, and a main area. Keep product-specific content out of this file.
 */
export function AppShell(p: AppShellProps) {
  const activeId = p.route.split("/")[0]
  const active = p.groups.flatMap((g) => g.items).find((i) => i.id === activeId)
  const label = active?.label ?? activeId.charAt(0).toUpperCase() + activeId.slice(1)
  const Brand = p.brand.icon
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" tooltip={p.brand.name}>
                <div className={cn("flex aspect-square size-8 items-center justify-center rounded-lg", p.brand.tileClassName ?? "bg-sidebar-primary text-sidebar-primary-foreground")}>
                  <Brand className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{p.brand.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{p.brand.context}</span>
                </div>
                <ChevronsUpDown className="ml-auto" />
              </SidebarMenuButton>
            </SidebarMenuItem>
            {p.sidebarTop}
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          {p.groups.map((g) => (
            <SidebarGroup key={g.label}>
              <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {g.items.map((n) => (
                    <SidebarMenuItem key={n.id}>
                      <SidebarMenuButton isActive={activeId === n.id} tooltip={n.label} onClick={() => p.onNavigate(n.id)}>
                        <n.icon />
                        <span>{n.label}</span>
                      </SidebarMenuButton>
                      {n.badge !== undefined && <SidebarMenuBadge>{n.badge}</SidebarMenuBadge>}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
          {p.sidebarExtra}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            {p.sidebarStatus}
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={`About ${p.brand.name}`} isActive={activeId === "about"} onClick={() => p.onNavigate("about")}>
                <Info />
                <span>About</span>
                <Badge variant="secondary" className="ml-auto h-5 font-mono text-[10px]">{p.version}</Badge>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">{p.brand.context}</BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                {p.crumb ? <span className="text-muted-foreground">{label}</span> : <BreadcrumbPage>{label}</BreadcrumbPage>}
              </BreadcrumbItem>
              {p.crumb && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem><BreadcrumbPage>{p.crumb}</BreadcrumbPage></BreadcrumbItem>
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-2">
            {p.headerActions}
            {(p.showThemeToggle ?? true) && <ThemeToggle />}
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{p.children}</main>
        {p.bottomBar}
      </SidebarInset>
    </SidebarProvider>
  )
}
