import { useMemo, useState } from "react";
import { Form, Link, redirect, useNavigate, useNavigation, useSubmit } from "react-router";
import { MoreHorizontal } from "lucide-react";
import { listEpisodeRows, createEpisode, duplicateEpisode, deleteEpisode } from "~/lib/episodes.server";
import { parseOptionalInt } from "~/lib/episode-fields";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { StatusBadge } from "~/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Page, PageHeader } from "~/components/layout/page";

const PAGE_SIZE = 7;

export async function loader() {
  return listEpisodeRows();
}

export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "duplicate") {
    const result = duplicateEpisode(String(form.get("id") ?? ""));
    if (!result.ok) return { error: result.error };
    return redirect(`/studio/episodes/${result.id}`);
  }
  if (intent === "delete") {
    await deleteEpisode(String(form.get("id") ?? ""));
    return redirect("/studio/episodes");
  }
  if (intent !== "create") return null;
  const number = parseOptionalInt(String(form.get("number") ?? ""));
  const season = parseOptionalInt(String(form.get("season") ?? ""));
  if (number === undefined || season === undefined) {
    return { error: "Season and episode must be whole numbers (or blank)." };
  }
  const result = createEpisode({ title: String(form.get("title") ?? ""), number, season });
  if (!result.ok) return { error: result.error };
  return redirect(`/studio/episodes/${result.id}`);
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
  actionData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
  actionData?: { error?: string } | null;
}) {
  const { show, rows } = loaderData;
  const navigation = useNavigation();
  const creating = navigation.state === "submitting";
  const [showNew, setShowNew] = useState(false);
  const [page, setPage] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const submit = useSubmit();
  const navigate = useNavigate();

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = useMemo(
    () => rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [rows, page],
  );

  if (!show) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        There's no show yet.
      </div>
    );
  }

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={show.title}
        title="Episodes"
        actions={
          <>
            <Link
              to="/studio/feed/tags"
              className="px-2 text-[12.5px] text-muted-foreground hover:text-foreground hover:underline"
            >
              Edit show details
            </Link>
            <Button type="button" size="sm" onClick={() => setShowNew((v) => !v)} aria-expanded={showNew}>
              New episode
            </Button>
          </>
        }
      />

      {(showNew || actionData?.error) && (
        <Form method="post" className="mb-5 flex flex-wrap items-end gap-3 rounded-[14px] border border-border bg-card p-4">
          <input type="hidden" name="intent" value="create" />
          <div className="flex min-w-[240px] flex-1 flex-col gap-1.5">
            <Label htmlFor="new-title">Title</Label>
            <Input id="new-title" name="title" required maxLength={200} autoFocus />
          </div>
          <div className="flex w-24 flex-col gap-1.5">
            <Label htmlFor="new-season">Season</Label>
            <Input id="new-season" name="season" inputMode="numeric" placeholder="auto" />
          </div>
          <div className="flex w-24 flex-col gap-1.5">
            <Label htmlFor="new-number">Episode</Label>
            <Input id="new-number" name="number" inputMode="numeric" placeholder="auto" />
          </div>
          <Button type="submit" disabled={creating}>
            Create
          </Button>
          {actionData?.error && <p className="w-full text-[13px] text-destructive">{actionData.error}</p>}
        </Form>
      )}

      <div className="overflow-hidden rounded-[14px] border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
              <th className="py-2.5 pl-4 pr-2 font-medium">Episode</th>
              <th className="px-2 py-2.5 font-medium">Status</th>
              <th className="hidden px-2 py-2.5 font-medium sm:table-cell">Length</th>
              <th className="hidden px-2 py-2.5 font-medium md:table-cell">Edited</th>
              <th className="w-12 px-2 py-2.5">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((ep) => (
              <tr
                key={ep.id}
                className="cursor-pointer border-b border-border last:border-b-0 hover:bg-accent/40"
                onClick={(e) => {
                  // The whole row opens the episode; links and the menu keep their own clicks.
                  if ((e.target as HTMLElement).closest("a,button,[role=menu]")) return;
                  navigate(`/studio/episodes/${ep.id}`);
                }}
              >
                <td className="py-3 pl-4 pr-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary font-mono text-[12.5px] text-muted-foreground">
                      {ep.number ?? "–"}
                    </div>
                    <div className="min-w-0">
                      <Link
                        to={`/studio/episodes/${ep.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {ep.title}
                      </Link>
                      <div className="text-[12.5px] text-muted-foreground">
                        {ep.guest ? `with ${ep.guest}` : "Solo"}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-3">
                  <StatusBadge status={ep.status} />
                </td>
                <td className="hidden px-2 py-3 font-mono text-[12.5px] text-muted-foreground sm:table-cell">
                  {formatDuration(ep.durationS)}
                </td>
                <td className="hidden px-2 py-3 text-[12.5px] text-muted-foreground md:table-cell">
                  {formatRelative(ep.updatedAt)}
                </td>
                <td className="px-2 py-3 text-right">
                  <DropdownMenu onOpenChange={(o) => !o && setConfirmDelete(null)}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Actions for episode ${ep.number ?? ep.title}`}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <MoreHorizontal className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem asChild>
                        <Link to={`/studio/episodes/${ep.id}`}>Open details</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to={`/studio/record/solo?episode=${ep.id}`}>Record</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to={`/studio/editor?episode=${ep.id}`}>Edit</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => submit({ intent: "duplicate", id: ep.id }, { method: "post" })}>
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {confirmDelete === ep.id ? (
                        <DropdownMenuItem
                          variant="destructive"
                          className="font-medium"
                          onSelect={() => submit({ intent: "delete", id: ep.id }, { method: "post" })}
                        >
                          Confirm delete
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={(e) => {
                            e.preventDefault();
                            setConfirmDelete(ep.id);
                          }}
                        >
                          Delete…
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
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
        {pageCount > 1 && (
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
        )}
      </div>
    </Page>
  );
}
