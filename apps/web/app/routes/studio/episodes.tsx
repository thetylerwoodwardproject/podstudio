import { useMemo, useState } from "react";
import { db, episodes, shows, people, episodePeople } from "@podstudio/db";
import { eq, desc } from "drizzle-orm";
import { StatusBadge } from "~/components/ui/status-badge";
import { cn } from "~/lib/utils";

const PAGE_SIZE = 7;

export async function loader() {
  const show = db.select().from(shows).get();
  if (!show) return { show: null, rows: [] as EpisodeRow[] };

  const rows = db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      status: episodes.status,
      durationS: episodes.durationS,
      updatedAt: episodes.updatedAt,
    })
    .from(episodes)
    .where(eq(episodes.showId, show.id))
    .orderBy(desc(episodes.number))
    .all();

  const guestByEpisode = new Map<string, string>();
  for (const row of rows) {
    const credits = db
      .select({ name: people.name, role: episodePeople.role })
      .from(episodePeople)
      .innerJoin(people, eq(people.id, episodePeople.personId))
      .where(eq(episodePeople.episodeId, row.id))
      .all();
    const guest = credits.find((c) => c.role === "guest");
    if (guest) guestByEpisode.set(row.id, guest.name);
  }

  return {
    show,
    rows: rows.map((r) => ({ ...r, guest: guestByEpisode.get(r.id) ?? null })),
  };
}

type EpisodeRow = {
  id: string;
  number: number | null;
  title: string;
  status: "recording" | "editing" | "scheduled" | "published";
  durationS: number | null;
  updatedAt: number;
  guest: string | null;
};

function formatDuration(s: number | null) {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function formatRelative(ms: number) {
  const diff = Date.now() - ms;
  const days = Math.round(diff / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export default function EpisodesRoute({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
}) {
  const { show, rows } = loaderData;
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = useMemo(
    () => rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [rows, page],
  );

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!show) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        No show seeded yet — run <code className="font-mono">pnpm db:seed</code>.
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-5 flex items-baseline justify-between">
        <div>
          <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
            {show.title}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Episodes</h1>
        </div>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[12.5px] text-muted-foreground">
              <th className="w-10 px-4 py-2.5">
                <input type="checkbox" aria-label="Select all episodes" disabled />
              </th>
              <th className="px-2 py-2.5">Episode</th>
              <th className="px-2 py-2.5">Status</th>
              <th className="px-2 py-2.5 font-mono">Length</th>
              <th className="px-2 py-2.5">Edited</th>
              <th className="w-10 px-2 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((ep) => (
              <tr
                key={ep.id}
                className="border-b border-border last:border-b-0 hover:bg-accent/40"
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={`Select episode ${ep.number}`}
                    checked={selected.has(ep.id)}
                    onChange={() => toggleRow(ep.id)}
                  />
                </td>
                <td className="px-2 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary font-mono text-[12.5px] text-muted-foreground">
                      {ep.number}
                    </div>
                    <div>
                      <div className="font-medium text-foreground">{ep.title}</div>
                      <div className="text-[12.5px] text-muted-foreground">
                        {ep.guest ? `with ${ep.guest}` : "Solo"}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-3">
                  <StatusBadge status={ep.status} />
                </td>
                <td className="px-2 py-3 font-mono text-[12.5px] text-muted-foreground">
                  {formatDuration(ep.durationS)}
                </td>
                <td className="px-2 py-3 text-[12.5px] text-muted-foreground">
                  {formatRelative(ep.updatedAt)}
                </td>
                <td className="relative px-2 py-3 text-right">
                  <button
                    aria-label={`Actions for episode ${ep.number}`}
                    className="rounded-md px-1.5 py-1 text-muted-foreground hover:bg-accent"
                    onClick={() => setOpenMenu((m) => (m === ep.id ? null : ep.id))}
                  >
                    ⋯
                  </button>
                  {openMenu === ep.id && (
                    <div
                      className="absolute right-2 top-full z-10 w-36 rounded-lg border border-border bg-popover py-1 text-left shadow-lg"
                      onMouseLeave={() => setOpenMenu(null)}
                    >
                      {["Open in editor", "Duplicate", "Delete"].map((action) => (
                        <button
                          key={action}
                          className={cn(
                            "block w-full px-3 py-1.5 text-left text-[13px] hover:bg-accent",
                            action === "Delete" && "text-destructive",
                          )}
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-[12.5px] text-muted-foreground">
        <span>
          {rows.length} episode{rows.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-md border border-input px-2 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            Page {page + 1} of {pageCount}
          </span>
          <button
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            className="rounded-md border border-input px-2 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
