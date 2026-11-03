import { useEffect, useState } from "react";

export interface LibraryItem {
  id: string;
  name: string;
  kind: "music" | "sfx";
  status: "queued" | "running" | "ready" | "failed";
  assetId: string | null;
  durationS: number | null;
  /** 2 for a stereo item. */
  channels?: 1 | 2;
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

export const clock = (s: number | null) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
