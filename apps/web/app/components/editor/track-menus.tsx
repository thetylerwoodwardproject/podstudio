import { useMemo, useState } from "react";
import { Link } from "react-router";
import { faCheck, faMagnifyingGlass, faPause, faPlay, faPlus, faTrashCan, faUpload } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Button } from "~/components/ui/button";
import { AudioPlayer, AudioPlayerPlay } from "~/components/ui/audio-player";
import { playIcon } from "~/components/ui/play-icon";
import { Input } from "~/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Separator } from "~/components/ui/separator";
import { TRACK_COLOR_PRESETS, type Track, type TrackKind } from "~/lib/project/document";
import { cn } from "~/lib/utils";
import { TRACK_COLORS } from "./draw";
import { clock, useLibraryItems, type LibraryItem } from "./library-panel";

export const KIND_LABEL: Record<TrackKind, string> = { host: "Host", guest: "Guest", music: "Music", sfx: "SFX" };
const KIND_HINT: Record<TrackKind, string> = { host: "Your mic", guest: "A guest's mic", music: "Beds, intros, outros", sfx: "Stingers, effects" };

const SectionTitle = ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={cn("px-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground", className)}>{children}</div>;

/** "+ Add track": an empty track of a kind, a library item on its own new track, or a file upload. */
export function AddTrackMenu({ onAdd, onAddFromLibrary, onUploadNew }: { onAdd: (kind: TrackKind) => void; onAddFromLibrary: (item: LibraryItem) => void; onUploadNew: (kind: TrackKind) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" data-testid="add-track">
          <FontAwesomeIcon icon={faPlus} /> Add track
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={8} className="flex max-h-[min(560px,var(--radix-popover-content-available-height))] w-[340px] flex-col gap-0 p-2" data-testid="add-track-menu" aria-label="Add track">
        {open && <AddTrackBody close={() => setOpen(false)} onAdd={onAdd} onAddFromLibrary={onAddFromLibrary} onUploadNew={onUploadNew} />}
      </PopoverContent>
    </Popover>
  );
}

function AddTrackBody({ close, onAdd, onAddFromLibrary, onUploadNew }: { close: () => void; onAdd: (kind: TrackKind) => void; onAddFromLibrary: (item: LibraryItem) => void; onUploadNew: (kind: TrackKind) => void }) {
  const items = useLibraryItems();
  const [q, setQ] = useState("");
  const ready = useMemo(() => (items ?? []).filter((i) => i.status === "ready" && i.assetId), [items]);
  const shown = ready.filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <SectionTitle className="pt-1">Empty track</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5">
        {(["host", "guest", "music", "sfx"] as const).map((k) => (
          <Button
            key={k}
            variant="outline"
            data-testid={`add-track-${k}`}
            onClick={() => {
              close();
              onAdd(k);
            }}
            className="h-auto justify-start gap-2.5 px-2.5 py-2 text-left"
          >
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: `var(${TRACK_COLORS[k]})` }} />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium leading-tight">{KIND_LABEL[k]}</span>
              <span className="block truncate text-[11px] font-normal leading-tight text-muted-foreground">{KIND_HINT[k]}</span>
            </span>
          </Button>
        ))}
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <SectionTitle>From the library</SectionTitle>
        <Link to="/studio/library" className="px-1 text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Manage</Link>
      </div>
      {ready.length > 5 && (
        <div className="relative mb-1.5">
          <FontAwesomeIcon icon={faMagnifyingGlass} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the library" aria-label="Search the library" data-testid="add-track-search" className="h-8 pl-7" />
        </div>
      )}
      <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto" data-testid="add-track-library">
        {items === null && <li className="px-2 py-2 text-[12.5px] text-muted-foreground">Loading…</li>}
        {items !== null && ready.length === 0 && (
          <li className="px-2 py-2 text-[12.5px] text-muted-foreground" data-testid="add-track-library-empty">
            Nothing here yet. <Link to="/studio/library" className="underline">Add your intro, outro or sound effects</Link> once and use them in every episode.
          </li>
        )}
        {ready.length > 0 && shown.length === 0 && <li className="px-2 py-2 text-[12.5px] text-muted-foreground">No matches.</li>}
        {shown.map((i) => (
          <li key={i.id} className="group flex items-center gap-0.5 rounded-sm px-1 hover:bg-accent" data-testid="add-track-library-item">
            <AudioPlayer src={`/studio/assets/${i.assetId}/audio`} preload="none" shortcuts={false} className="contents" aria-label={`Preview ${i.name}`}>
                      <AudioPlayerPlay className="size-7 shrink-0 rounded-full text-muted-foreground hover:bg-background hover:text-foreground [&_svg]:size-3" data-testid="library-preview">{playIcon}</AudioPlayerPlay>
                    </AudioPlayer>
            <button
              type="button"
              title="Add on a new track at the playhead"
              data-testid="add-track-library-add"
              onClick={() => {
                close();
                onAddFromLibrary(i);
              }}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-sm py-1.5 pr-1.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: `var(${TRACK_COLORS[i.kind]})` }} />
              <span className="min-w-0 flex-1 truncate text-[13px]">{i.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{i.kind === "sfx" ? "SFX" : "Music"} · {clock(i.durationS)}</span>
              <FontAwesomeIcon icon={faPlus} className="shrink-0 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100" />
            </button>
          </li>
        ))}
      </ul>
      {ready.length > 0 && <p className="px-1 pt-1 text-[11px] text-muted-foreground">Goes on its own new track, at the playhead.</p>}

      <Separator className="my-2" />
      <div className="flex items-center gap-0.5">
        <FontAwesomeIcon icon={faUpload} className="ml-1.5 text-[11px] text-muted-foreground" />
        <span className="mx-1 text-[12px] text-muted-foreground">Upload to a new</span>
        {(["music", "sfx", "guest", "host"] as const).map((k) => (
          <Button
            key={k}
            variant="ghost"
            size="sm"
            data-testid={`add-track-upload-${k}`}
            onClick={() => {
              close();
              onUploadNew(k);
            }}
            className="h-7 px-2 text-[12px]"
          >
            {KIND_LABEL[k]}
          </Button>
        ))}
      </div>
    </>
  );
}

/** Per-track options popover (colour and delete), opened from the "⋯" button or the track's right-click menu. */
export function TrackOptions({
  track,
  clipCount,
  open,
  onOpenChange,
  confirmDelete,
  onColor,
  onDelete,
  children,
}: {
  track: Track;
  clipCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open straight into the delete confirmation. */
  confirmDelete: boolean;
  onColor: (c: string | null) => void;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const [confirm, setConfirm] = useState(false);
  const asking = confirm || (confirmDelete && clipCount > 0);
  const current = track.color ?? null;
  const custom = !!current && !TRACK_COLOR_PRESETS.includes(current as (typeof TRACK_COLOR_PRESETS)[number]);
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        if (!v) setConfirm(false);
        onOpenChange(v);
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" collisionPadding={8} className="w-[252px] p-3" data-testid="track-menu" aria-label={`${track.name} options`} onClick={(e) => e.stopPropagation()}>
        <SectionTitle>Color</SectionTitle>
        <div className="grid grid-cols-7 gap-1.5" role="radiogroup" aria-label="Track color">
          {TRACK_COLOR_PRESETS.map((c) => (
            <Swatch key={c} label={COLOR_NAMES[c] ?? c} color={c} selected={current === c} onClick={() => onColor(c)} testid={`track-color-${c.slice(1)}`} />
          ))}
          <label title="Custom color" className={cn("relative flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-input text-[11px] text-muted-foreground hover:border-ring hover:text-foreground", custom && "border-solid ring-2 ring-foreground ring-offset-2 ring-offset-popover")} style={custom ? { background: current! } : undefined}>
            <FontAwesomeIcon icon={custom ? faCheck : faPlus} className={cn(custom && "text-[#111113]")} />
            <input type="color" aria-label="Custom color" data-testid="track-color-custom" value={current ?? "#888888"} onChange={(e) => onColor(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
          </label>
        </div>
        <Button variant={current === null ? "secondary" : "ghost"} size="sm" role="radio" aria-checked={current === null} onClick={() => onColor(null)} data-testid="track-color-default" className="mt-2.5 w-full justify-start font-normal">
          <span className="size-3.5 shrink-0 rounded-full" style={{ background: `var(${TRACK_COLORS[track.kind]})` }} />
          <span className="flex-1 text-left">Default {KIND_LABEL[track.kind].toLowerCase()} color</span>
          {current === null && <FontAwesomeIcon icon={faCheck} className="text-[11px]" />}
        </Button>
        <Separator className="my-3" />
        {!asking ? (
          <Button
            variant="ghost"
            size="sm"
            data-testid="track-delete"
            disabled={track.locked}
            title={track.locked ? "Unlock the track to delete it" : undefined}
            onClick={() => (clipCount > 0 ? setConfirm(true) : onDelete())}
            className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <FontAwesomeIcon icon={faTrashCan} /> Delete track{track.locked ? " (locked)" : ""}
          </Button>
        ) : (
          <div className="flex flex-col gap-2" data-testid="track-delete-confirm">
            <p className="text-[12.5px]">
              Delete “{track.name}” and its {clipCount} clip{clipCount === 1 ? "" : "s"}? You can undo this.
            </p>
            <div className="flex gap-1.5">
              <Button variant="destructive" size="sm" onClick={onDelete} data-testid="track-delete-yes">Delete</Button>
              <Button variant="outline" size="sm" onClick={() => (confirm ? setConfirm(false) : onOpenChange(false))}>Cancel</Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

const COLOR_NAMES: Record<string, string> = { "#000000": "Black (shows as bone on the dark timeline)", "#fabf47": "Gold", "#00fff5": "Cyan", "#beff00": "Lime", "#ff807f": "Coral", "#c7bff6": "Lavender" };

function Swatch({ label, color, selected, onClick, testid }: { label: string; color: string; selected: boolean; onClick: () => void; testid: string }) {
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={label} title={label} onClick={onClick} data-testid={testid} className={cn("relative flex size-7 items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-popover transition-shadow hover:ring-2 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring", color === "#000000" && "shadow-[inset_0_0_0_1px_var(--border)]", selected && "ring-2 ring-foreground hover:ring-foreground")} style={{ background: color }}>
      {selected && <FontAwesomeIcon icon={faCheck} className={cn("text-[11px]", color === "#000000" ? "text-white" : "text-[#111113]")} />}
    </button>
  );
}
