import { Link, useRevalidator } from "react-router";
import { useEffect } from "react";
import { deleteRecording, getSoloContext, listEpisodesToRecord, saveScript } from "~/lib/recordings.server";
import { SoloStage } from "~/components/recorder/solo-stage";
import { StatusBadge } from "~/components/ui/status-badge";

// Screen 07 (Solo prompter) — Stage 03: record yourself in the browser at full
// quality. `?episode=<id>` opens the recording stage for that episode; without it,
// pick an episode. The stage itself is a full-screen overlay (components/recorder).
export async function loader({ request }: { request: Request }) {
  const id = new URL(request.url).searchParams.get("episode");
  if (!id) return { choose: listEpisodesToRecord(), ctx: null };
  const ctx = getSoloContext(id);
  if (!ctx) throw new Response("Episode not found", { status: 404 });
  return { choose: null, ctx };
}

export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  const id = new URL(request.url).searchParams.get("episode") ?? "";
  if (form.get("intent") === "save-script") saveScript(id, String(form.get("script") ?? ""));
  if (form.get("intent") === "delete-recording") await deleteRecording(String(form.get("id") ?? ""));
  return { ok: true };
}

export default function RecordSolo({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { revalidate } = useRevalidator();
  useEffect(() => {
    // A finished take should appear in "Earlier takes" without a manual reload.
    const onDone = () => revalidate();
    window.addEventListener("podstudio:take-finished", onDone);
    return () => window.removeEventListener("podstudio:take-finished", onDone);
  }, [revalidate]);

  if (loaderData.ctx) return <SoloStage {...loaderData.ctx} />;
  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-5">
        <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">Record</div>
        <h1 className="text-2xl font-semibold tracking-tight">Solo recording</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Pick the episode this take belongs to.</p>
      </div>
      <ul className="flex flex-col gap-2">
        {loaderData.choose!.map((e) => (
          <li key={e.id}>
            <Link to={`/studio/record/solo?episode=${e.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:bg-accent/40">
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
