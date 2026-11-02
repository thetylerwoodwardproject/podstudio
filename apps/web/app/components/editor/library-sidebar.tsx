import { useMemo, useState } from "react";
import { Link } from "react-router";
import { faAnglesLeft, faAnglesRight, faMagnifyingGlass, faPause, faPlay, faPlus, faRecordVinyl } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import { TRACK_COLORS } from "./draw";
import { clock, useLibraryItems, useLibraryPreview, type LibraryItem } from "./library-panel";

/** Drag type for library items dropped on the timeline. */
export const LIBRARY_DRAG_TYPE = "application/x-podstudio-library";

/**
 * The simple editor's right-hand sidebar (Hindenburg's "Clipboard"): the show's reusable audio,
 * grouped by kind. Click + to add at the playhead on a new track, or drag an item onto a track.
 */
export function LibrarySidebar({ collapsed, onCollapsedChange, onAdd }: { collapsed: boolean; onCollapsedChange: (c: boolean) => void; onAdd: (item: LibraryItem) => void }) {
  const items = useLibraryItems();
  const { playing, toggle } = useLibraryPreview();
  const [q, setQ] = useState("");
  const ready = useMemo(() => (items ?? []).filter((i) => i.status === "ready" && i.assetId), [items]);
  const match = (i: LibraryItem) => i.name.toLowerCase().includes(q.trim().toLowerCase());
  const groups: { kind: LibraryItem["kind"]; title: string }[] = [
    { kind: "music", title: "Music" },
    { kind: "sfx", title: "Sound effects" },
  ];

  if (collapsed) {
    return (
      <aside className="flex w-11 min-h-0 flex-col items-center gap-1 border-l border-border bg-background py-2" aria-label="Library (collapsed)" data-testid="library-rail">
        <Button variant="ghost" size="icon" onClick={() => onCollapsedChange(false)} aria-label="Show library" title="Show library (I)" className="size-8 text-[12px] text-muted-foreground">
          <FontAwesomeIcon icon={faAnglesLeft} />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => onCollapsedChange(false)} aria-label="Library" title="Library" className="size-8 text-[13px] text-muted-foreground">
          <FontAwesomeIcon icon={faRecordVinyl} />
        </Button>
      </aside>
    );
  }

  return (
    <aside className="flex w-64 min-h-0 flex-col border-l border-border bg-background" aria-label="Library" data-testid="library-sidebar">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border pl-3 pr-1">
        <span className="flex-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Library</span>
        <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-[11.5px] text-muted-foreground">
          <Link to="/studio/library">Manage</Link>
        </Button>
        <Button variant="ghost" size="icon" onClick={() => onCollapsedChange(true)} aria-label="Hide library" title="Hide library (I)" className="size-7 text-[12px] text-muted-foreground">
          <FontAwesomeIcon icon={faAnglesRight} />
        </Button>
      </div>
      <div className="relative shrink-0 p-2">
        <FontAwesomeIcon icon={faMagnifyingGlass} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search the library" className="h-8 pl-7 text-[12.5px]" data-testid="library-sidebar-search" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {items === null && <p className="px-2 py-2 text-[12.5px] text-muted-foreground">Loading…</p>}
        {items !== null && ready.length === 0 && (
          <p className="px-2 py-2 text-[12.5px] leading-relaxed text-muted-foreground">
            Nothing here yet. <Link to="/studio/library" className="underline">Add your intro, outro and sound effects</Link> once; they'll be here for every episode.
          </p>
        )}
        {groups.map((g) => {
          const list = ready.filter((i) => i.kind === g.kind && match(i));
          if (list.length === 0) return null;
          return (
            <section key={g.kind} className="mb-2">
              <h3 className="flex items-center gap-2 px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                <span className="size-2 rounded-full" style={{ background: `var(${TRACK_COLORS[g.kind]})` }} />
                {g.title}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {list.map((i) => (
                  <li
                    key={i.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(LIBRARY_DRAG_TYPE, JSON.stringify(i));
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    className="group flex cursor-grab items-center gap-1 rounded-md px-1 hover:bg-accent active:cursor-grabbing"
                    title="Drag onto a track, or press + to add at the playhead"
                    data-testid="library-sidebar-item"
                  >
                    <Button variant="ghost" size="icon" onClick={() => toggle(i)} aria-label={playing === i.id ? `Stop ${i.name}` : `Preview ${i.name}`} className={cn("size-7 shrink-0 rounded-full text-[10px] text-muted-foreground hover:bg-background", playing === i.id && "text-foreground")}>
                      <FontAwesomeIcon icon={playing === i.id ? faPause : faPlay} />
                    </Button>
                    <span className="min-w-0 flex-1 truncate py-1.5 text-[12.5px]">{i.name}</span>
                    <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">{clock(i.durationS)}</span>
                    <Button variant="ghost" size="icon" onClick={() => onAdd(i)} aria-label={`Add ${i.name} at the playhead`} title="Add at the playhead, on a new track" data-testid="library-sidebar-add" className="size-7 shrink-0 text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                      <FontAwesomeIcon icon={faPlus} />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
