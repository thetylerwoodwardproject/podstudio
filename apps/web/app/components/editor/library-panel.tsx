import { useEffect, useRef, useState } from "react";
import { faPause, faPlay, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Link } from "react-router";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export interface LibraryItem {
  id: string;
  name: string;
  kind: "music" | "sfx";
  status: "queued" | "running" | "ready" | "failed";
  assetId: string | null;
  durationS: number | null;
}

/** The show's library items (fetched once per mount). `null` while loading. */
export function useLibraryItems(enabled = true) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch("/studio/library/items")
      .then((r) => r.json())
      .then((b) => live && setItems(b.items))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [enabled]);
  return items;
}

/** Preview one library item at a time; stops when the component unmounts. */
export function useLibraryPreview() {
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = (i: LibraryItem) => {
    if (!i.assetId) return;
    audio.current?.pause();
    if (playing === i.id) return setPlaying(null);
    const a = new Audio(`/studio/assets/${i.assetId}/audio`);
    a.onended = () => setPlaying(null);
    audio.current = a;
    setPlaying(i.id);
    void a.play().catch(() => setPlaying(null));
  };
  return { playing, toggle };
}

export const clock = (s: number | null) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);

/** The show's library, from inside the editor: preview an item, then add it to the selected track or a new one. */
export function LibraryPanel({ selectedTrackName, onAdd, onClose }: { selectedTrackName: string | null; onAdd: (item: LibraryItem, where: "selected" | "new") => void; onClose: () => void }) {
  const items = useLibraryItems();
  const { playing, toggle: preview } = useLibraryPreview();
  const ready = (items ?? []).filter((i) => i.status === "ready");
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[8vh]" role="dialog" aria-modal="true" aria-label="Library" data-testid="library-dialog" onClick={onClose}>
      <div className="flex max-h-[76vh] w-[560px] max-w-[94vw] flex-col rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          <h2 className="text-[15px] font-semibold">Library</h2>
          <Link to="/studio/library" className="text-[12.5px] text-muted-foreground underline hover:text-foreground">Manage</Link>
          <button type="button" aria-label="Close library" onClick={onClose} className="ml-auto flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {items === null && <p className="p-3 text-[13px] text-muted-foreground">Loading…</p>}
          {items !== null && ready.length === 0 && (
            <p className="p-3 text-[13px] text-muted-foreground" data-testid="library-empty">Nothing in the library yet. <Link to="/studio/library" className="underline">Add your intro, outro or sound effects</Link> and they'll show up here for every episode.</p>
          )}
          <ul className="flex flex-col gap-1.5" data-testid="library-items">
            {ready.map((i) => (
              <li key={i.id} className="flex items-center gap-2.5 rounded-lg border border-border px-2.5 py-2" data-testid="library-item">
                <button type="button" onClick={() => preview(i)} aria-label={playing === i.id ? `Stop ${i.name}` : `Preview ${i.name}`} className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-[12px] hover:bg-accent"><FontAwesomeIcon icon={playing === i.id ? faPause : faPlay} /></button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{i.name}</div>
                  <div className="text-[11.5px] text-muted-foreground">{i.kind === "sfx" ? "Sound effect" : "Music"} · {clock(i.durationS)}</div>
                </div>
                {selectedTrackName && (
                  <Button size="sm" variant="outline" onClick={() => onAdd(i, "selected")} title={`Add at the playhead on “${selectedTrackName}”`} data-testid="library-add-selected" className={cn("max-w-[150px]")}>
                    <span className="truncate">To “{selectedTrackName}”</span>
                  </Button>
                )}
                <Button size="sm" onClick={() => onAdd(i, "new")} data-testid="library-add-new">New {i.kind === "sfx" ? "SFX" : "music"} track</Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
