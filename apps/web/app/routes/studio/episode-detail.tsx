import { toHtml } from "~/lib/rich-text.server";
import { RichTextField } from "~/components/rich-text-field";
import { ViewPublicPage } from "~/components/view-public";
import { useState } from "react";
import { Form, Link, redirect, useNavigation } from "react-router";
import {
  getEpisodeWithCredits,
  deleteEpisode,
  updateEpisode,
  addCredit,
  removeCredit,
  listShowPeople,
} from "~/lib/episodes.server";
import { getEpisodeAudio, hasFeedMediaTarget } from "~/lib/media.server";
import { EpisodeAudioSection } from "~/components/episode-audio";
import { parseOptionalInt } from "~/lib/episode-fields";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { StatusBadge } from "~/components/ui/status-badge";

// This file deliberately imports nothing from @podstudio/db or drizzle-orm
// (all db access lives in episodes.server.ts) — see storage.tsx's comment
// for why: a route file that imports a db-exported value for client-side
// rendering (this one used to render `episodeStatus.map(...)` straight from
// @podstudio/db) pulls drizzle-orm's runtime into that route's client chunk,
// where it throws and silently breaks navigation to the screen. EPISODE_
// STATUS below is the client-safe replacement; it must stay in sync by hand
// with `episodeStatus` in packages/db/src/schema.ts.
const EPISODE_STATUS = ["recording", "editing", "scheduled", "published"] as const;

export async function loader({ params }: { params: { id: string } }) {
  const result = getEpisodeWithCredits(params.id);
  if (!result) throw new Response("Episode not found", { status: 404 });
  return {
    ...result,
    knownPeople: listShowPeople(),
    audio: getEpisodeAudio(params.id),
    storageReady: hasFeedMediaTarget(),
    descriptionHtml: toHtml(result.episode.description),
  };
}

export async function action({ request, params }: { request: Request; params: { id: string } }) {
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "add-credit") {
    const r = addCredit(params.id, String(form.get("name") ?? ""), String(form.get("role") ?? ""));
    return r.ok ? { credited: true } : { creditError: r.error };
  }
  if (intent === "remove-credit") {
    removeCredit(params.id, String(form.get("personId") ?? ""), String(form.get("role") ?? ""));
    return { creditRemoved: true };
  }

  if (intent === "delete") {
    await deleteEpisode(params.id);
    return redirect("/studio/episodes");
  }

  // Deliberately not editable here: `guid`/`guidIsPermalink`/`publicId` — immutable
  // once set, per BUILD_PLAN's GUID rules (non-negotiable #1).
  const season = parseOptionalInt(String(form.get("season") ?? ""));
  const number = parseOptionalInt(String(form.get("number") ?? ""));
  if (season === undefined || number === undefined) {
    return { error: "Season and episode must be whole numbers (or blank)." };
  }
  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "A title is required." };

  updateEpisode(params.id, {
    season,
    number,
    explicit: form.get("explicit") === "on",
    title,
    subtitle: (form.get("subtitle") as string) || null,
    description: (form.get("description") as string) || null,
    status: form.get("status") as (typeof EPISODE_STATUS)[number],
    visibility: form.get("visibility") as "private" | "unlisted" | "public",
  });

  return { saved: true };
}

export default function EpisodeDetail({
  loaderData,
  actionData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
  actionData?: { saved?: boolean; error?: string; creditError?: string; credited?: boolean };
}) {
  const { episode, credits, knownPeople, audio, storageReady, descriptionHtml } = loaderData;
  const navigation = useNavigation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const saving = navigation.state === "submitting";

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-5 flex items-baseline justify-between">
        <div>
          <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
            Episode {episode.number}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{episode.title}</h1>
          {(
            <Link
              to={`/studio/publish?episode=${episode.id}`}
              className="text-[12.5px] text-muted-foreground underline hover:text-foreground"
            >
              {episode.status === "published" ? "Manage publishing / unpublish" : "Publish to feed"}
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {episode.status === "published" && episode.visibility === "public" && (
            <ViewPublicPage path={`/episodes/${episode.publicId}/${episode.slug}`} label="View public episode page" />
          )}
          <StatusBadge status={episode.status} />
        </div>
      </div>

      <Form method="post" className="flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" defaultValue={episode.title} required />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="subtitle">Subtitle</Label>
          <Input id="subtitle" name="subtitle" defaultValue={episode.subtitle ?? ""} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="description">Description</Label>
          <RichTextField name="description" label="Episode description" defaultValue={descriptionHtml} minHeight={200} />
          <p className="text-[12px] text-muted-foreground">
            These are the show notes: shown on the episode page, as the snippet in the episode list, and in podcast apps (apps
            get the simple formatting only). Web links and timestamps like <span className="font-mono">12:34</span> become
            clickable on the public page.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="flex w-28 flex-col gap-1.5">
            <Label htmlFor="season">Season</Label>
            <Input id="season" name="season" inputMode="numeric" defaultValue={episode.season ?? ""} />
          </div>
          <div className="flex w-28 flex-col gap-1.5">
            <Label htmlFor="number">Episode</Label>
            <Input id="number" name="number" inputMode="numeric" defaultValue={episode.number ?? ""} />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" name="explicit" defaultChecked={!!episode.explicit} />
            Explicit
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              name="status"
              defaultValue={episode.status}
              className="rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {EPISODE_STATUS.map((s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="visibility">Visibility</Label>
            <select
              id="visibility"
              name="visibility"
              defaultValue={episode.visibility}
              className="rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="private">Private</option>
              <option value="unlisted">Unlisted</option>
              <option value="public">Public</option>
            </select>
          </div>
        </div>

        {actionData?.error && <p className="text-[13px] text-destructive">{actionData.error}</p>}
        {actionData?.saved && (
          <p className="text-[13px] text-ok">Saved.</p>
        )}

        <div className="flex items-center justify-between pt-2">
          <Button type="submit" name="intent" value="save" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </Form>

      <section className="mt-5 flex flex-col gap-3 rounded-[14px] border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-muted-foreground">People</h2>
        {credits.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">No credited people yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5" data-testid="credits">
            {credits.map((c) => (
              <li key={`${c.id}-${c.role}`} className="flex items-center justify-between text-[13px]">
                <span>
                  {c.name} <span className="text-muted-foreground">({c.role ?? "unset"})</span>
                </span>
                <Form method="post">
                  <input type="hidden" name="intent" value="remove-credit" />
                  <input type="hidden" name="personId" value={c.id} />
                  <input type="hidden" name="role" value={c.role ?? ""} />
                  <Button type="submit" variant="ghost" size="sm">
                    Remove
                  </Button>
                </Form>
              </li>
            ))}
          </ul>
        )}
        <Form method="post" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="intent" value="add-credit" />
          <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
            <Label htmlFor="credit-name">Name</Label>
            <Input id="credit-name" name="name" list="known-people" required maxLength={120} />
            <datalist id="known-people">
              {knownPeople.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="credit-role">Role</Label>
            <select
              id="credit-role"
              name="role"
              defaultValue="guest"
              className="rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="host">Host</option>
              <option value="guest">Guest</option>
            </select>
          </div>
          <Button type="submit" variant="outline">
            Add
          </Button>
        </Form>
        {actionData?.creditError && <p className="text-[13px] text-destructive">{actionData.creditError}</p>}
      </section>

      <Separator className="my-6" />

      <EpisodeAudioSection episodeId={episode.id} audio={audio} storageReady={storageReady} />

      <Separator className="my-6" />

      <Form method="post" className="flex items-center gap-3">
        <input type="hidden" name="intent" value="delete" />
        {confirmingDelete ? (
          <>
            <span className="text-[13px] text-muted-foreground">
              Delete this episode? This can't be undone.
            </span>
            <Button type="submit" variant="destructive" size="sm">
              Confirm delete
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-destructive"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete episode
          </Button>
        )}
      </Form>
    </div>
  );
}
