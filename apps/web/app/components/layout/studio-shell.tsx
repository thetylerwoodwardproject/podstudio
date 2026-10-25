import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import {
  Mic,
  Rss,
  Layers,
  SlidersHorizontal,
  PenLine,
  Server,
  Command,
  LogOut,
  ChevronDown,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { signOut } from "~/lib/auth-client";
import { CommandPalette } from "./command-palette";
import { ShowSlugContext } from "./shell-context";

// Sidebar laid out after the mockup (docs/design "Podstudio v2": logo, show card,
// Episodes, Podcast hosting with its sub-nav, then the settings-style items).
// Items for screens that don't exist yet (Show templates, FX presets, Writing
// style) are shown disabled rather than linking to a 404. Screens that have no
// sidebar entry in the mockup (Record, Editor, Clips, Publish to feed) are reached
// from the episode and from the command menu (⌘K), which lists every screen.
type Item = { label: string; to: string; end?: boolean; match?: (path: string) => boolean };

const HOSTING: Item[] = [
  { label: "Feed", to: "/studio/feed", end: true },
  { label: "Analytics", to: "/studio/analytics" },
  { label: "Show tags", to: "/studio/feed/tags", match: (p) => p.startsWith("/studio/feed/") },
  { label: "Podroll", to: "/studio/podroll" },
  { label: "Storage", to: "/studio/storage", match: (p) => p === "/studio/storage" },
  { label: "Move podcast", to: "/studio/storage/move" },
];
// Real screens under "Public page & embeds"; the mockup lists the group as one
// item, these are its pages (so Brand & theme / Public page links stay reachable).
const PUBLIC: Item[] = [
  { label: "Embed players", to: "/studio/public/embeds" },
  { label: "Hosts & guests", to: "/studio/people", match: (p) => p.startsWith("/studio/people") },
  { label: "Public page links", to: "/studio/public/links" },
  { label: "Brand & theme", to: "/studio/public/brand" },
];
const NOT_BUILT = [
  { label: "Show templates", Icon: Layers },
  { label: "FX presets", Icon: SlidersHorizontal },
  { label: "Writing style", Icon: PenLine },
];

const row = "flex items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-[14px]";
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export function StudioShell({
  user,
  show,
  role,
}: {
  user: { name: string; email: string };
  show: { title: string; slug: string; episodes: number; artworkUrl: string | null } | null;
  role: "admin" | "editor" | null;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();

  const inHosting =
    pathname === "/studio/feed" ||
    pathname.startsWith("/studio/feed/") ||
    ["/studio/analytics", "/studio/podroll", "/studio/storage"].some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/studio/people") ||
    pathname.startsWith("/studio/public/");
  // Collapsible sections. Default: Podcast hosting open while you're inside it. Choices
  // persist per browser; entering a collapsed section (e.g. via a "fix it" link)
  // reopens it so the current page is visible in the menu.
  const [open, setOpen] = useState<Record<string, boolean>>({ hosting: inHosting, public: true });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("podstudio.sidebar") ?? "null");
      if (saved && typeof saved === "object") setOpen((o) => ({ ...o, ...saved }));
    } catch {
      /* storage unavailable: defaults apply */
    }
  }, []);
  function toggle(key: string) {
    setOpen((o) => {
      const next = { ...o, [key]: !o[key] };
      try {
        localStorage.setItem("podstudio.sidebar", JSON.stringify(next));
      } catch {
        /* not persisted */
      }
      return next;
    });
  }
  // Only on a *transition* into the section — a reload keeps what you chose.
  const wasInHosting = useRef(inHosting);
  useEffect(() => {
    if (inHosting && !wasInHosting.current) setOpen((o) => (o.hosting ? o : { ...o, hosting: true }));
    wasInHosting.current = inHosting;
  }, [inHosting]);

  // Publishing and the per-episode screens belong to the Episodes entry.
  const inEpisodes = pathname.startsWith("/studio/episodes") || pathname === "/studio/publish";

  // Deep links like /studio/feed/tags#category: the page scrolls inside <main>, not
  // the window, so the browser's own anchor scrolling doesn't apply — do it here.
  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    const t = setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) el.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [pathname, hash]);

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

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

  const sub = (item: Item, nested = false) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      className={({ isActive }) => {
        const active = item.match ? item.match(pathname) : isActive;
        return cn(
          "block rounded-md py-1.5 text-[13px] hover:text-foreground",
          nested ? "pl-7 pr-2.5" : "px-2.5",
          active ? "font-semibold text-foreground" : "text-muted-foreground",
        );
      }}
    >
      {item.label}
    </NavLink>
  );

  // Pinned to the viewport (not h-screen/100vh, which can exceed the visible height
  // and let the whole page scroll). overflow-clip, unlike hidden, also blocks
  // programmatic scrolling of this box (focus, scrollIntoView), so only <main> and
  // the sidebar nav ever scroll.
  return (
    <div className="fixed inset-0 grid grid-cols-[248px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-clip bg-background text-foreground">
      <aside className="flex min-h-0 flex-col border-r border-sidebar-border bg-sidebar px-3.5 py-4">
        <div className="mb-4 flex items-center gap-2.5 px-1.5 text-[15px] font-bold tracking-tight">
          <span className="flex size-[18px] items-center justify-center rounded-full border-2 border-destructive">
            <span className="size-1.5 rounded-full bg-destructive" />
          </span>
          Podstudio
        </div>

        {show && (
          <div className="mb-4 flex items-center gap-2.5 rounded-[10px] border border-border px-2.5 py-2" data-testid="show-card">
            {show.artworkUrl ? (
              <img src={show.artworkUrl} alt="" className="size-8 shrink-0 rounded-md object-cover" />
            ) : (
              <div className="size-8 shrink-0 rounded-md bg-secondary" aria-hidden />
            )}
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold leading-tight">{show.title}</div>
              <div className="text-[11px] text-muted-foreground">
                {show.episodes} episode{show.episodes === 1 ? "" : "s"}
              </div>
            </div>
          </div>
        )}

        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-y-contain" aria-label="Studio">
          <NavLink
            to="/studio/episodes"
            className={cn(
              row,
              "text-muted-foreground hover:text-foreground",
              inEpisodes && "bg-sidebar-accent font-semibold text-foreground shadow-[inset_3px_0_0_var(--studio-nav-bar,transparent)]",
            )}
          >
            <Mic className="size-4" />
            Episodes
          </NavLink>

          <div className="relative">
            <NavLink
              to="/studio/feed"
              className={cn(
                row,
                "pr-9 text-muted-foreground hover:text-foreground",
                inHosting && "bg-sidebar-accent font-semibold text-foreground shadow-[inset_3px_0_0_var(--studio-nav-bar,transparent)]",
              )}
            >
              <Rss className="size-4" />
              Podcast hosting
            </NavLink>
            <button
              type="button"
              onClick={() => toggle("hosting")}
              aria-expanded={!!open.hosting}
              aria-controls="nav-hosting"
              aria-label={open.hosting ? "Collapse Podcast hosting" : "Expand Podcast hosting"}
              data-testid="toggle-hosting"
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            >
              <ChevronDown className={cn("size-3.5 transition-transform", !open.hosting && "-rotate-90")} />
            </button>
          </div>
          {open.hosting && (
            <div id="nav-hosting" className="my-0.5 ml-[18px] flex flex-col border-l border-border pl-2">
              {HOSTING.map((i) => sub(i))}
              <button
                type="button"
                onClick={() => toggle("public")}
                aria-expanded={!!open.public}
                aria-controls="nav-public"
                data-testid="toggle-public"
                className="mt-1 flex items-center justify-between rounded-md px-2.5 pb-0.5 pt-1.5 text-left text-[11px] text-muted-foreground/80 hover:text-foreground"
              >
                Public page &amp; embeds
                <ChevronDown className={cn("size-3 transition-transform", !open.public && "-rotate-90")} />
              </button>
              {open.public && <div id="nav-public" className="flex flex-col">{PUBLIC.map((i) => sub(i, false))}</div>}
            </div>
          )}

          {NOT_BUILT.map(({ label, Icon }) => (
            <div
              key={label}
              className={cn(row, "cursor-not-allowed text-muted-foreground/50")}
              aria-disabled="true"
              title="Not built yet"
            >
              <Icon className="size-4" />
              {label}
            </div>
          ))}

          <NavLink
            to="/studio/settings/server"
            className={({ isActive }) =>
              cn(
                row,
                "text-muted-foreground hover:text-foreground",
                isActive && "bg-sidebar-accent font-semibold text-foreground shadow-[inset_3px_0_0_var(--studio-nav-bar,transparent)]",
              )
            }
          >
            <Server className="size-4" />
            Server settings
          </NavLink>
        </nav>

        <div className="mt-3 flex items-center gap-2.5 border-t border-sidebar-border px-1 pt-3">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground">
            {initials(user.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold leading-tight" title={user.email}>
              {user.name}
            </div>
            <div className="text-[11px] capitalize text-muted-foreground">{role ?? ""}</div>
          </div>
          <button
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command menu"
            title="Command menu (⌘K)"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <Command className="size-3.5" />
          </button>
          <button
            onClick={handleSignOut}
            aria-label={`Sign out of ${user.email}`}
            title="Sign out"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
      </aside>

      <main className="min-h-0 overflow-y-auto overscroll-y-contain">
        <ShowSlugContext.Provider value={show?.slug ?? null}>
          <Outlet />
        </ShowSlugContext.Provider>
      </main>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
