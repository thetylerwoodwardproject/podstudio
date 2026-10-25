import { useState } from "react";
import { Form, Link, redirect, useNavigation } from "react-router";
import { deletePerson, getPersonAdmin, updatePerson } from "~/lib/people.server";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ShowArtwork } from "~/components/show-artwork";
import { RichTextField } from "~/components/rich-text-field";
import { ViewPublicPage } from "~/components/view-public";

export async function loader({ params }: { params: { id?: string } }) {
  const d = getPersonAdmin(params.id ?? "");
  if (!d) throw new Response("Not found", { status: 404 });
  return d;
}

export async function action({ request, params }: { request: Request; params: { id?: string } }) {
  const id = params.id ?? "";
  const form = await request.formData();
  const str = (n: string) => String(form.get(n) ?? "");
  if (str("intent") === "delete") {
    const r = await deletePerson(id);
    return r.ok ? redirect("/studio/people") : { error: r.error };
  }
  const r = updatePerson(id, { name: str("name"), role: str("role"), bio: str("bio"), website: str("website") });
  return r.ok ? { saved: true } : { error: r.error };
}

export default function PersonDetail({
  loaderData,
  actionData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
  actionData?: { saved?: boolean; error?: string };
}) {
  const { person, avatar, storageReady, credits, onPublicSite, publicPath } = loaderData;
  const nav = useNavigation();
  const [confirm, setConfirm] = useState(false);
  const select =
    "h-9 rounded-md border border-input bg-transparent px-3 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/studio/people" className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground">
            ← Hosts &amp; guests
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{person.name}</h1>
        </div>
        {onPublicSite ? (
          <ViewPublicPage path={publicPath} label="View public profile" />
        ) : (
          <span className="text-[12.5px] text-muted-foreground">Not on the public site until credited on a published episode</span>
        )}
      </div>

      <ShowArtwork
        artwork={avatar ? { url: avatar.url, width: null, height: null, bytes: avatar.bytes, contentType: avatar.contentType } : null}
        storageReady={storageReady}
        endpoint={`/studio/people/${person.id}/avatar`}
        heading="Headshot"
        noun="photo"
        sectionId="headshot"
        rules="PNG or JPEG, at least 200×200 pixels, up to 5 MB. Shown cropped to a square or circle."
        missing="Without a photo, their initials are shown."
      />

      <Form method="post" className="flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" defaultValue={person.name} required maxLength={120} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role">Role</Label>
            <select id="role" name="role" defaultValue={person.role === "host" ? "host" : "guest"} className={select}>
              <option value="host" className="bg-popover">Host</option>
              <option value="guest" className="bg-popover">Guest</option>
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bio">Bio</Label>
          <RichTextField name="bio" label="Bio" defaultValue={person.bioHtml} minHeight={140} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="website">Website</Label>
          <Input id="website" name="website" type="url" defaultValue={person.website ?? ""} placeholder="https://" />
        </div>
        {actionData?.error && <p role="alert" className="text-[13px] text-destructive" data-testid="person-error">{actionData.error}</p>}
        {actionData?.saved && <p className="text-[13px] text-ok">Saved.</p>}
        <div>
          <Button type="submit" name="intent" value="save" disabled={nav.state === "submitting"}>
            Save changes
          </Button>
        </div>
      </Form>

      <section className="mt-6 rounded-[14px] border border-border bg-card p-5">
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Credited on</h2>
        {credits.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">No episodes yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {credits.map((c) => (
              <li key={`${c.episodeId}-${c.role}`} className="flex items-center justify-between gap-3">
                <Link to={`/studio/episodes/${c.episodeId}`} className="hover:underline">
                  {c.number != null ? `${c.number}. ` : ""}
                  {c.title}
                </Link>
                <span className="text-muted-foreground capitalize">
                  {c.role} · {c.status === "published" && c.visibility === "public" ? "public" : c.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 flex items-center justify-between gap-3 rounded-[14px] border border-border p-4">
        <p className="text-[12.5px] text-muted-foreground">
          {credits.length > 0 ? "Remove their credits from episodes before deleting them." : "Deleting removes the profile and photo."}
        </p>
        <Form method="post">
          {confirm ? (
            <Button type="submit" name="intent" value="delete" variant="destructive" size="sm" disabled={credits.length > 0}>
              Confirm delete
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled={credits.length > 0} onClick={() => setConfirm(true)}>
              Delete person
            </Button>
          )}
        </Form>
      </section>
    </div>
  );
}
