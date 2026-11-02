import { Link, useRevalidator } from "react-router";
import { desc, eq } from "drizzle-orm";
import { db, episodes, shows } from "@podstudio/db";
import { EditorStage } from "~/components/editor/editor-stage";
import { Button } from "~/components/ui/button";
import { StatusBadge } from "~/components/ui/status-badge";
import { listEditableRecordings, loadProject, missingSources } from "~/lib/project/project.server";

// Screen 08 (Editor) — Stage 04. `?episode=<id>` opens that episode's edit project (created
// from a finished recording the first time); without it, pick an episode.
export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const id = url.searchParams.get("episode");
  if (!id) {
    return { kind: "choose" as const, episodes: db.select({ id: episodes.id, title: episodes.title, number: episodes.number, status: episodes.status }).from(episodes).orderBy(desc(episodes.number)).all() };
  }
  const ep = db.select().from(episodes).where(eq(episodes.id, id)).get();
  if (!ep) throw new Response("Episode not found", { status: 404 });
  const show = db.select({ title: shows.title }).from(shows).where(eq(shows.id, ep.showId)).get();
  const episode = { id: ep.id, title: ep.title, number: ep.number, showTitle: show?.title ?? "" };
  const project = loadProject(id);
  if (project) return { kind: "edit" as const, openCleanup: url.searchParams.get("cleanup") === "1", openExport: url.searchParams.get("export") === "1", episode, project: { revisionId: project.revisionId, seq: project.seq, doc: project.doc, missing: missingSources(project.doc) } };
  return { kind: "start" as const, episode, recordings: listEditableRecordings(id) };
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function Editor({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  if (loaderData.kind === "edit") return <EditorStage key={loaderData.episode.id} openCleanup={loaderData.openCleanup} openExport={loaderData.openExport} episode={loaderData.episode} project={loaderData.project} />;
  if (loaderData.kind === "start") return <Start {...loaderData} />;
  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-5">
        <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">Edit</div>
        <h1 className="text-2xl font-semibold tracking-tight">Editor</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Pick the episode to edit.</p>
      </div>
      <ul className="flex flex-col gap-2">
        {loaderData.episodes.map((e) => (
          <li key={e.id}>
            <Link to={`/studio/editor?episode=${e.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:bg-accent/40">
              <span className="flex size-9 items-center justify-center rounded-md bg-secondary font-mono text-[12.5px] text-muted-foreground">{e.number ?? "–"}</span>
              <span className="flex-1 text-sm font-medium">{e.title}</span>
              <StatusBadge status={e.status} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Start({ episode, recordings }: { episode: { id: string; title: string }; recordings: ReturnType<typeof listEditableRecordings> }) {
  const { revalidate } = useRevalidator();
  const start = (recordingId: string) => {
    void fetch(`/studio/projects/${episode.id}/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordingId }) })
      .then((r) => r.json())
      .then((b) => (b.ok ? revalidate() : alert(b.error ?? "Couldn't start the project.")));
  };
  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-5">
        <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">Edit</div>
        <h1 className="text-2xl font-semibold tracking-tight">{episode.title}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Choose the take to start editing. Your recording is never changed — edits only decide which parts play.</p>
      </div>
      {recordings.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-5 text-sm">
          <p className="mb-3">There's no finished recording for this episode yet.</p>
          <Button asChild><Link to={`/studio/record/solo?episode=${episode.id}`}>Record one</Link></Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="take-list">
          {recordings.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex-1">
                <div className="text-sm font-medium" suppressHydrationWarning>{new Date(r.startedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</div>
                <div className="font-mono text-[12px] text-muted-foreground">{clock((r.totalSamples ?? 0) / r.sampleRate)} · {r.status}</div>
              </div>
              <Button onClick={() => start(r.id)} data-testid="start-editing">Start editing</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
