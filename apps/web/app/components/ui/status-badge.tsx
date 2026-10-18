import { cn } from "~/lib/utils";
import type { EpisodeStatus } from "@podstudio/db";

const STATUS_STYLES: Record<EpisodeStatus, string> = {
  recording: "bg-destructive/15 text-destructive border-destructive/30",
  editing: "bg-accent text-accent-foreground border-border",
  scheduled: "bg-music/15 text-music border-music/30",
  published: "bg-ok/15 text-ok border-ok/30",
};

const STATUS_LABEL: Record<EpisodeStatus, string> = {
  recording: "Recording",
  editing: "Editing",
  scheduled: "Scheduled",
  published: "Published",
};

export function StatusBadge({ status }: { status: EpisodeStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12.5px] font-medium",
        STATUS_STYLES[status],
      )}
    >
      {status === "recording" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}
