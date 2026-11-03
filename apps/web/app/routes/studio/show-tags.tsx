import { ViewPublicPage } from "~/components/view-public";
import { useState } from "react";
import { db, shows } from "@podstudio/db";
import { eq } from "drizzle-orm";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { HelpPopover, HelpTerm } from "~/components/ui/help-popover";
import { Link } from "react-router";
import { ShowArtwork } from "~/components/show-artwork";
import { artworkFile, getShowArtwork } from "~/lib/artwork.server";
import { hasFeedMediaTarget } from "~/lib/media.server";
import { PODCAST_CATEGORIES, cleanCategory } from "~/lib/podcast-categories";
import { cleanForStorage, toHtml } from "~/lib/rich-text.server";
import { RichTextField } from "~/components/rich-text-field";
import { FormSelect } from "~/components/ui/form-select";
import { Checkbox } from "~/components/ui/checkbox";
import { Page, PageHeader } from "~/components/layout/page";

// Screen 16 (Show tags). Per README: "RSS 2.0/iTunes fields plus Podcasting 2.0
// tags... GUID is never editable or removable through a toggle." Scoped down from
// the full spec: `person` lives on the `people` table (not duplicated here),
// `podroll` is Stage 11, and TXT records are screen 16b's own flow — none of
// those three are built here. Funding/value/medium/trailer/updateFrequency/
// license are stored in `podcastTags` json since they don't need their own columns.
interface PodcastTags {
  author?: string;
  category?: string;
  subcategory?: string;
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
      <FormSelect
        id={id}
        name={id}
        defaultValue={defaultValue ?? ""}
        options={[{ value: "", label: "Not set" }, ...options.map((o) => ({ value: o, label: o }))]}
      />
    </div>
  );
}

function CategoryPicker({ primary, sub }: { primary?: string; sub?: string }) {
  const [cat, setCat] = useState(primary && Object.hasOwn(PODCAST_CATEGORIES, primary) ? primary : "");
  const subs = cat ? PODCAST_CATEGORIES[cat] ?? [] : [];
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="category">Category</Label>
        <FormSelect
          id="category"
          name="category"
          value={cat}
          onValueChange={setCat}
          options={[{ value: "", label: "Not set" }, ...Object.keys(PODCAST_CATEGORIES).map((c) => ({ value: c, label: c }))]}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="subcategory">Subcategory</Label>
        <FormSelect
          key={cat}
          id="subcategory"
          name="subcategory"
          defaultValue={cat === primary ? sub ?? "" : ""}
          disabled={subs.length === 0}
          options={[
            { value: "", label: subs.length === 0 ? "None for this category" : "Not set" },
            ...subs.map((s) => ({ value: s, label: s })),
          ]}
        />
      </div>
    </div>
  );
}

export async function loader() {
  const show = db.select().from(shows).get();
  if (!show) throw new Response("No show seeded yet", { status: 404 });
  const art = getShowArtwork();
  const dims = (art?.meta ?? {}) as { width?: number; height?: number };
  return {
    show,
    descriptionHtml: toHtml(show.description),
    storageReady: hasFeedMediaTarget(),
    artwork: art
      ? {
          url: `/${show.slug}/artwork/${artworkFile(art)}`,
          width: dims.width ?? null,
          height: dims.height ?? null,
          bytes: art.bytes,
          contentType: art.contentType,
        }
      : null,
  };
}

export async function action({ request }: { request: Request }) {
  const show = db.select().from(shows).get();
  if (!show) throw new Response("No show seeded yet", { status: 404 });

  const form = await request.formData();
  const str = (name: string) => (form.get(name) as string) || undefined;

  const category = cleanCategory(form.get("category"), form.get("subcategory"));
  const podcastTags: PodcastTags = {
    author: str("author"),
    category: category?.primary,
    subcategory: category?.sub ?? undefined,
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
      description: cleanForStorage(str("description") ?? null),
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
  const { show, artwork, storageReady, descriptionHtml } = loaderData;
  const tags = (show.podcastTags as PodcastTags | null) ?? {};

  return (
    <Page>
      <PageHeader eyebrow="Podcast hosting" title="Show tags" description="Your show's artwork, description and the tags podcast apps read from the feed." actions={<ViewPublicPage />} />

      <ShowArtwork artwork={artwork} storageReady={storageReady} />

      <form method="post" className="flex flex-col gap-6">
        <section className="flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-muted-foreground">RSS 2.0 / iTunes</h2>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" defaultValue={show.title} required />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">Description</Label>
            <RichTextField name="description" label="Show description" defaultValue={descriptionHtml} minHeight={120} />
            <p className="text-[12px] text-muted-foreground">
              Shown at the top of your public page. Podcast apps get it as plain text.
            </p>
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="author">Author</Label>
            <Input id="author" name="author" defaultValue={tags.author ?? ""} placeholder="Shown under the title in Apple Podcasts" />
          </div>

          <CategoryPicker primary={tags.category} sub={tags.subcategory} />

          <label className="flex items-center gap-2 text-sm">
            <Checkbox id="explicit" name="explicit" defaultChecked={!!show.explicit} />
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
        Recommended shows are on the{" "}
        <Link to="/studio/podroll" className="underline hover:text-foreground">
          Podroll
        </Link>{" "}
        page. TXT records and feed locking are in{" "}
        <Link to="/studio/feed/lock-verify" className="underline hover:text-foreground">
          Lock &amp; verify
        </Link>
        .
      </p>
    </Page>
  );
}
