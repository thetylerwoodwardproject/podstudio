import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { cn } from "~/lib/utils";
import type { ImportItem } from "./use-imports";

export function UploadsStrip({ items, onCancel, onDismissLocal }: { items: ImportItem[]; onCancel: (jobId: string) => void; onDismissLocal: (key: string) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex shrink-0 flex-col gap-1 border-t border-border bg-background px-3 py-2" data-testid="uploads-strip" aria-label="Audio uploads">
      {items.map((i) => (
        <li key={i.key} className="flex items-center gap-3 text-[12.5px]" data-testid="upload-item" data-phase={i.phase}>
          <span className="max-w-[260px] truncate font-medium" title={i.name}>{i.name}</span>
          {i.phase === "failed" ? (
            <span className="min-w-0 flex-1 truncate text-destructive" title={i.error} role="alert">{i.error ?? "Failed"}</span>
          ) : (
            <>
              <span className="w-28 text-muted-foreground">{i.phase === "uploading" ? `Uploading ${Math.round(i.pct * 100)}%` : "Converting…"}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={Math.round(i.pct * 100)} aria-valuemin={0} aria-valuemax={100}>
                <span className={cn("block h-full bg-primary transition-[width]", i.phase === "decoding" && "animate-pulse")} style={{ width: `${Math.max(3, i.pct * 100)}%` }} />
              </span>
            </>
          )}
          <button
            type="button"
            aria-label={i.phase === "failed" ? `Dismiss ${i.name}` : `Cancel ${i.name}`}
            title={i.phase === "failed" ? "Dismiss" : "Cancel"}
            onClick={() => (i.jobId ? onCancel(i.jobId) : onDismissLocal(i.key))}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </li>
      ))}
    </ul>
  );
}
