import { db, shows } from "@podstudio/db";
import { eq } from "drizzle-orm";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { HelpPopover, HelpTerm } from "~/components/ui/help-popover";
import { Link } from "react-router";

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

// Controlled vocabularies from the Podcast Namespace spec — these are dropdowns,
// not free text, because the field only means something to apps/directories if
// it's one of these values. `valueAddress`, `fundingUrl`/`fundingMessage` and
// `trailerUrl` stay free text because they're genuinely user-specific.
const VALUE_TYPE_OPTIONS = ["lightning"];
const VALUE_METHOD_OPTIONS = ["keysend", "lnaddress"];
const MEDIUM_OPTIONS = [
  "podcast",
  "music",
  "video",
  "film",
  "audiobook",
  "newsletter",
  "blog",
];
const UPDATE_FREQUENCY_OPTIONS = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "yearly",
  "adhoc",
];
const LICENSE_OPTIONS = [
  "cc-by",
  "cc-by-nc",
  "cc-by-nd",
  "cc-by-sa",
  "cc-by-nc-nd",
  "cc-by-nc-sa",
  "cc0",
  "all-rights-reserved",
];

function SelectField({
  id,
  label,
  defaultValue,
  options,
}: {
  id: string;
  label: string;
  defaultValue?: string;
  options: string[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={id}
        defaultValue={defaultValue ?? ""}
        className="rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <option value="">Not set</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
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
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Podcasting 2.0 (subset)
            </h2>
            <HelpPopover label="Podcasting 2.0 tags">
              <HelpTerm term="funding">
                A link + message inviting listeners to support the show financially
                (Patreon, a donation page, etc.).
              </HelpTerm>
              <HelpTerm term="value">
                "Value4Value" micropayments over the Lightning Network. Type is
                always <code>lightning</code> today; method is how the payment is
                routed (<code>keysend</code> sends directly to a node,{" "}
                <code>lnaddress</code> uses a human-readable address like an
                email); address is your actual node pubkey or lightning address.
              </HelpTerm>
              <HelpTerm term="medium">
                What kind of show this is — affects how podcast apps categorize
                and display it. Most shows are <code>podcast</code>.
              </HelpTerm>
              <HelpTerm term="trailer URL">
                A short preview episode's media URL, for apps that show a trailer
                before someone subscribes.
              </HelpTerm>
              <HelpTerm term="update frequency">
                How often you publish — lets apps know how often to check for new
                episodes instead of polling constantly.
              </HelpTerm>
              <HelpTerm term="license">
                The content license listeners and other apps must follow when
                reusing your audio (e.g. Creative Commons variants, or "all
                rights reserved").
              </HelpTerm>
            </HelpPopover>
          </div>

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
            <SelectField
              id="valueType"
              label="Value type"
              defaultValue={tags.valueType}
              options={VALUE_TYPE_OPTIONS}
            />
            <SelectField
              id="valueMethod"
              label="Value method"
              defaultValue={tags.valueMethod}
              options={VALUE_METHOD_OPTIONS}
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="valueAddress">Value address</Label>
              <Input id="valueAddress" name="valueAddress" defaultValue={tags.valueAddress ?? ""} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <SelectField
              id="medium"
              label="Medium"
              defaultValue={tags.medium}
              options={MEDIUM_OPTIONS}
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="trailerUrl">Trailer URL</Label>
              <Input id="trailerUrl" name="trailerUrl" type="url" defaultValue={tags.trailerUrl ?? ""} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <SelectField
              id="updateFrequency"
              label="Update frequency"
              defaultValue={tags.updateFrequency}
              options={UPDATE_FREQUENCY_OPTIONS}
            />
            <SelectField
              id="license"
              label="License"
              defaultValue={tags.license}
              options={LICENSE_OPTIONS}
            />
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
              {show.locked ? "locked" : "unlocked"} —{" "}
              <Link to="/studio/feed/lock-verify" className="underline hover:text-foreground">
                manage in Lock &amp; verify
              </Link>
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
        podroll isn't built yet — it arrives in Stage 11. TXT records and feed
        locking are in{" "}
        <Link to="/studio/feed/lock-verify" className="underline hover:text-foreground">
          Lock &amp; verify
        </Link>
        .
      </p>
    </div>
  );
}
