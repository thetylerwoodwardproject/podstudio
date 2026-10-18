import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import {
  Mic,
  LayoutList,
  Scissors,
  Share2,
  Rss,
  HardDrive,
  Globe,
  BarChart3,
  Settings,
  Command,
} from "lucide-react";
import { sidebarScreens } from "~/lib/screens";
import { cn } from "~/lib/utils";
import { CommandPalette } from "./command-palette";

// One icon per sidebar section, matching Stage-00's "sidebar with Podcast hosting
// sub-nav" + the Record/Edit/Publish groupings from README's screen sections.
const SECTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "Account & episodes": LayoutList,
  Record: Mic,
  Edit: Scissors,
  "Publish & share": Share2,
  "Podcast hosting": Rss,
  "Public page & embeds": Globe,
  "Analytics & discovery": BarChart3,
  Server: Settings,
  "Storage": HardDrive,
};

export function StudioShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();
  const groups = sidebarScreens();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="grid h-screen grid-cols-[240px_1fr] bg-background text-foreground">
      <aside className="flex flex-col border-r border-border bg-sidebar">
        <div className="flex h-[54px] items-center gap-2 border-b border-sidebar-border px-4">
          <span className="h-2 w-2 rounded-full bg-destructive" />
          <span className="text-sm font-semibold tracking-tight">Podstudio</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {groups.map((group) => {
            const Icon = SECTION_ICONS[group.section] ?? LayoutList;
            return (
              <div key={group.section} className="mb-4">
                <div className="px-2 pb-1 text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
                  {group.section}
                </div>
                {group.screens.map((screen) => (
                  <NavLink
                    key={screen.id}
                    to={screen.path}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-secondary-foreground hover:bg-sidebar-accent",
                        isActive && "bg-sidebar-accent",
                      )
                    }
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {screen.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-h-0 flex-col">
        <header className="flex h-[54px] items-center justify-between border-b border-border bg-[#141416] px-4">
          <span className="text-sm text-muted-foreground">
            {groups
              .flatMap((g) => g.screens)
              .find((s) => s.path === location.pathname)?.label ?? "Podstudio"}
          </span>
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-input bg-card px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            <Command className="h-3.5 w-3.5" />
            <span>Command menu</span>
            <kbd className="rounded border border-border bg-background px-1 font-mono text-[11px]">
              ⌘K
            </kbd>
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
