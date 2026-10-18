import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { SCREENS } from "~/lib/screens";
import { cn } from "~/lib/utils";

// Stage-00 asks for "⌘K palette (empty commands)" — there are no real app
// commands yet, so this only does screen navigation (search over the same
// registry the sidebar uses) until later stages add real actions.
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Dynamic routes (e.g. episode details' /studio/episodes/:id) have no single
  // destination to jump to — leave them out of the palette rather than navigate
  // to a literal ":id".
  const navigable = useMemo(() => SCREENS.filter((s) => !s.path.includes(":")), []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return navigable.slice(0, 8);
    return navigable
      .filter((s) => s.label.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, navigable]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[20vh]"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Jump to a screen…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <ul className="max-h-80 overflow-y-auto p-1">
          {results.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">No matches.</li>
          )}
          {results.map((s) => (
            <li key={s.id}>
              <button
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-accent",
                )}
                onClick={() => {
                  navigate(s.path);
                  onOpenChange(false);
                }}
              >
                <span>{s.label}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{s.id}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
