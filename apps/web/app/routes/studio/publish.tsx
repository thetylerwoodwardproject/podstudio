import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { listPublishable, getPublishData, scheduleEpisode, unscheduleEpisode } from "~/lib/publish.server";
import { itemXml } from "~/lib/item-xml";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { StatusBadge } from "~/components/ui/status-badge";

// Screen 14 (Publish to feed) at `/studio/publish?episode=<id>`. Per README:
// release now/schedule, Podcasting 2.0 item tags, upload progress, item XML
// preview. Real: choosing an unpublished episode, scheduling (interpreted in
// the show's timezone; sets status "scheduled" + publishAt) and unscheduling,
// a read-only tag checklist driven by what actually exists, and the item XML
// preview built from the stored episode (guid exactly as stored).
// Deferred, stated on the screen: "Publish now" (the feed audio file must be
// uploaded and verified first — Stage 02, no media pipeline exists), file
// upload progress, the enclosure, and transcript/chapters/soundbite/
// alternate-enclosure/value tags (nothing backs them). Per-tag switches are
// omitted: toggling tags that can't be emitted would be decoration.
// No db imports here — see publish.server.ts.
export async function loader({ request }: { request: Request }) {
  const id = new URL(request.url).searchParams.get("episode");
  return { choices: listPublishable(), data: id ? getPublishData(id) : null };
}

export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const intent = form.get("intent");
  if (intent === "schedule") {
    const r = scheduleEpisode(id, String(form.get("publishAt") ?? ""));
    return r.ok ? { scheduled: true } : { error: r.error };
  }
  if (intent === "unschedule") {
    const r = unscheduleEpisode(id);
    return r.ok ? { unscheduled: true } : { error: r.error };
  }
  return null;
}

const TAGS: { label: string; real: (d: NonNullable<Awaited<ReturnType<typeof loader>>["data"]>) => boolean; missing: string }[] = [
  { label: "title, guid, pubDate", real: () => true, missing: "" },
  { label: "itunes:season / episode / duration / explicit", real: () => true, missing: "" },
  { label: "podcast:person", real: (d) => d.credits.length > 0, missing: "no people credited on this episode" },
  { label: "enclosure (MP3)", real: () => false, missing: "no audio file uploaded — Stage 02" },
  { label: "podcast:transcript", real: () => false, missing: "no transcript — Stage 07" },
  { label: "podcast:chapters", real: () => false, missing: "no chapters yet" },
  { label: "podcast:soundbite", real: () => false, missing: "no soundbites yet" },
  { label: "podcast:alternateEnclosure (video)", real: () => false, missing: "no video renditions — Stage 10a" },
  { label: "podcast:value", real: () => false, missing: "value-for-value isn't wired into items yet" },
];

export default function Publish({
  loaderData,
  actionData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
  actionData?: { error?: string; scheduled?: boolean; unscheduled?: boolean };
}) {
  const { choices, data } = loaderData;
  const [params, setParams] = useSearchParams();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-5">
        <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">Publish &amp; share</div>
        <h1 className="text-2xl font-semibold tracking-tight">Publish to feed</h1>
      </div>

      <section className="flex flex-col gap-2 rounded-[14px] border border-border bg-card p-5">
        <Label htmlFor="episode">Episode</Label>
        {choices.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">No unpublished episodes.</p>
        ) : (
          <select
            id="episode"
            value={params.get("episode") ?? ""}
            onChange={(e) => setParams(e.target.value ? { episode: e.target.value } : {})}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="">Choose an episode…</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.number != null ? `Ep. ${c.number} — ` : ""}
                {c.title} ({c.status})
              </option>
            ))}
          </select>
        )}
      </section>

      {params.get("episode") && !data && (
        <p className="mt-5 text-[13px] text-destructive">That episode doesn't exist.</p>
      )}

      {data && (
        <>
          <section className="mt-5 flex flex-col gap-3 rounded-[14px] border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground">Release</h2>
              <StatusBadge status={data.episode.status} />
            </div>
            <p className="text-[12.5px] text-muted-foreground">
              Publish now isn't available: an episode only appears in the feed after its audio file is
              uploaded and verified, and there's no upload pipeline yet. You can schedule it.
            </p>
            {data.episode.status === "scheduled" && data.episode.publishAt && (
              <p className="text-[13px]" data-testid="scheduled-at">
                Scheduled for{" "}
                {new Date(data.episode.publishAt).toLocaleString("en-US", {
                  timeZone: data.timezone,
                  dateStyle: "medium",
                  timeStyle: "short",
                })}{" "}
                ({data.timezone})
              </p>
            )}
            <Form method="post" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={data.episode.id} />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="publishAt">Publish at ({data.timezone})</Label>
                <Input id="publishAt" name="publishAt" type="datetime-local" required />
              </div>
              <Button type="submit" name="intent" value="schedule" disabled={submitting || data.episode.status === "recording"}>
                {data.episode.status === "scheduled" ? "Reschedule" : "Schedule"}
              </Button>
              {data.episode.status === "scheduled" && (
                <Button type="submit" name="intent" value="unschedule" variant="outline" disabled={submitting} formNoValidate>
                  Unschedule
                </Button>
              )}
            </Form>
            {data.episode.status === "recording" && (
              <p className="text-[12.5px] text-muted-foreground">Finish recording and editing before scheduling.</p>
            )}
            {actionData?.error && <p className="text-[13px] text-destructive">{actionData.error}</p>}
            {actionData?.scheduled && <p className="text-[13px] text-ok">Scheduled.</p>}
            {actionData?.unscheduled && <p className="text-[13px] text-ok">Unscheduled — back to editing.</p>}
          </section>

          <section className="mt-5 flex flex-col gap-2 rounded-[14px] border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-muted-foreground">Podcasting 2.0 for this episode</h2>
            <ul className="flex flex-col gap-1 text-[13px]" data-testid="tags">
              {TAGS.map((t) => {
                const ok = t.real(data);
                return (
                  <li key={t.label} className="flex items-baseline gap-2">
                    <span aria-hidden>{ok ? "✓" : "–"}</span>
                    <span className={ok ? "" : "text-muted-foreground"}>{t.label}</span>
                    {!ok && <span className="text-[11.5px] text-muted-foreground">— {t.missing}</span>}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="mt-5 flex flex-col gap-2 rounded-[14px] border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-muted-foreground">Feed item preview (read-only)</h2>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-[12px]" data-testid="item-xml">
              {itemXml({
                title: data.episode.title,
                guid: data.episode.guid,
                guidIsPermalink: data.episode.guidIsPermalink,
                pubDate: data.episode.publishAt ?? null,
                season: data.episode.season,
                number: data.episode.number,
                durationS: data.episode.durationS,
                explicit: !!data.episode.explicit,
                people: data.credits,
              })}
            </pre>
            <Link to={`/studio/episodes/${data.episode.id}`} className="text-[12.5px] text-muted-foreground underline hover:text-foreground">
              Edit episode details
            </Link>
          </section>
        </>
      )}
    </div>
  );
}
