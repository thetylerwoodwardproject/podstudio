import { db, shows } from "@podstudio/db";
import { eq } from "drizzle-orm";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";

// Screen 16 (Show tags). Per README: "RSS 2.0/iTunes fields plus Podcasting 2.0
// tags... GUID is never editable or removable through a toggle." Scoped down from
// the full spec: `person` lives on the `people` table (not duplicated here),
// `podroll` is Stage 11, and TXT records are screen 16b's own flow — none of
// those three are built here. Funding/value/medium/trailer/updateFrequency/
// license are stored in `podcastTags` json since they don't need their own columns.
interface PodcastTags {
  fundingUrl?: string;
  fundingMessage?: string;
  valueType?: string;
  valueMethod?: string;
  valueAddress?: string;
  medium?: string;
  trailerUrl?: string;
  updateFrequency?: string;
  license?: string;
}

export async function loader() {
  const show = db.select().from(shows).get();
  if (!show) throw new Response("No show seeded yet", { status: 404 });
  return { show };
}

export async function action({ request }: { request: Request }) {
  const show = db.select().from(shows).get();
  if (!show) throw new Response("No show seeded yet", { status: 404 });

  const form = await request.formData();
  const str = (name: string) => (form.get(name) as string) || undefined;

  const podcastTags: PodcastTags = {
    fundingUrl: str("fundingUrl"),
    fundingMessage: str("fundingMessage"),
    valueType: str("valueType"),
    valueMethod: str("valueMethod"),
    valueAddress: str("valueAddress"),
    medium: str("medium"),
    trailerUrl: str("trailerUrl"),
    updateFrequency: str("updateFrequency"),
    license: str("license"),
  };

  db.update(shows)
    .set({
      title: String(form.get("title") ?? show.title),
      description: str("description") ?? null,
      website: str("website") ?? null,
      language: String(form.get("language") ?? "en"),
      explicit: form.get("explicit") === "on" ? 1 : 0,
      podcastTags,
    })
    .where(eq(shows.id, show.id))
    .run();

  return { saved: true };
}

export default function ShowTags({
  loaderData,
  actionData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
  actionData?: { saved?: boolean };
}) {
  const { show } = loaderData;
  const tags = (show.podcastTags as PodcastTags | null) ?? {};

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-5">
        <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
          Podcast hosting
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Show tags</h1>
      </div>

      <form method="post" className="flex flex-col gap-6">
        <section className="flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-muted-foreground">RSS 2.0 / iTunes</h2>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" defaultValue={show.title} required />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              name="description"
              defaultValue={show.description ?? ""}
              rows={3}
              className="rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="website">Website</Label>
              <Input id="website" name="website" type="url" defaultValue={show.website ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="language">Language</Label>
              <Input id="language" name="language" defaultValue={show.language} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="explicit" defaultChecked={!!show.explicit} />
            Explicit content
          </label>
        </section>

        <section className="flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Podcasting 2.0 (subset)
          </h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fundingUrl">Funding URL</Label>
              <Input id="fundingUrl" name="fundingUrl" type="url" defaultValue={tags.fundingUrl ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fundingMessage">Funding message</Label>
              <Input id="fundingMessage" name="fundingMessage" defaultValue={tags.fundingMessage ?? ""} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="valueType">Value type</Label>
              <Input id="valueType" name="valueType" placeholder="lightning" defaultValue={tags.valueType ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="valueMethod">Value method</Label>
              <Input id="valueMethod" name="valueMethod" placeholder="keysend" defaultValue={tags.valueMethod ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="valueAddress">Value address</Label>
              <Input id="valueAddress" name="valueAddress" defaultValue={tags.valueAddress ?? ""} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="medium">Medium</Label>
              <Input id="medium" name="medium" placeholder="podcast" defaultValue={tags.medium ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="trailerUrl">Trailer URL</Label>
              <Input id="trailerUrl" name="trailerUrl" type="url" defaultValue={tags.trailerUrl ?? ""} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="updateFrequency">Update frequency</Label>
              <Input id="updateFrequency" name="updateFrequency" placeholder="weekly" defaultValue={tags.updateFrequency ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="license">License</Label>
              <Input id="license" name="license" defaultValue={tags.license ?? ""} />
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-muted-foreground">Identity (read-only)</h2>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-muted-foreground">podcast:guid</span>
            <span className="font-mono text-[12.5px]">{show.podcastGuid}</span>
          </div>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-muted-foreground">Feed lock</span>
            <span className="font-mono text-[12.5px]">
              {show.locked ? "locked" : "unlocked"} — managed in Lock &amp; verify (16b)
            </span>
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            Never editable here, by design: changing an existing show's GUID makes
            every subscriber see the catalog as new.
          </p>
        </section>

        {actionData?.saved && <p className="text-[13px] text-ok">Saved.</p>}

        <div>
          <Button type="submit">Save changes</Button>
        </div>
      </form>

      <Separator className="my-6" />
      <p className="text-[12.5px] text-muted-foreground">
        podroll and TXT records aren't built yet — podroll arrives in Stage 11,
        TXT records in screen 16b (Lock &amp; verify).
      </p>
    </div>
  );
}
