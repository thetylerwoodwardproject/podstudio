import { useState } from "react";
import { Form, redirect, useNavigation } from "react-router";
import { eq } from "drizzle-orm";
import {
  db,
  episodes,
  episodePeople,
  people,
  episodeStatus,
  type EpisodeStatus,
} from "@podstudio/db";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { StatusBadge } from "~/components/ui/status-badge";

export async function loader({ params }: { params: { id: string } }) {
  const episode = db.select().from(episodes).where(eq(episodes.id, params.id)).get();
  if (!episode) throw new Response("Episode not found", { status: 404 });

  const credits = db
    .select({ id: people.id, name: people.name, role: episodePeople.role })
    .from(episodePeople)
    .innerJoin(people, eq(people.id, episodePeople.personId))
    .where(eq(episodePeople.episodeId, episode.id))
    .all();

  return { episode, credits };
}

export async function action({ request, params }: { request: Request; params: { id: string } }) {
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "delete") {
    db.delete(episodePeople).where(eq(episodePeople.episodeId, params.id)).run();
    db.delete(episodes).where(eq(episodes.id, params.id)).run();
    return redirect("/studio/episodes");
  }

  // Deliberately not editable here: `guid`/`guidIsPermalink`/`publicId` — immutable
  // once set, per BUILD_PLAN's GUID rules (non-negotiable #1).
  db.update(episodes)
    .set({
      title: String(form.get("title") ?? ""),
      subtitle: (form.get("subtitle") as string) || null,
      description: (form.get("description") as string) || null,
      status: form.get("status") as EpisodeStatus,
      visibility: form.get("visibility") as "private" | "unlisted" | "public",
      updatedAt: Date.now(),
    })
    .where(eq(episodes.id, params.id))
    .run();

  return { saved: true };
}

export default function EpisodeDetail({
  loaderData,
  actionData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
  actionData?: { saved?: boolean };
}) {
  const { episode, credits } = loaderData;
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
        </div>
        <StatusBadge status={episode.status} />
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
          <textarea
            id="description"
            name="description"
            defaultValue={episode.description ?? ""}
            rows={4}
            className="rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
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
              {episodeStatus.map((s) => (
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

        <div className="text-[12.5px] text-muted-foreground">
          {credits.length > 0
            ? credits.map((c) => `${c.name} (${c.role})`).join(", ")
            : "No credited people yet"}
        </div>

        {actionData?.saved && (
          <p className="text-[13px] text-ok">Saved.</p>
        )}

        <div className="flex items-center justify-between pt-2">
          <Button type="submit" name="intent" value="save" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </Form>

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
