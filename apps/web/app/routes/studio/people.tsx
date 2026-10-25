import { Form, Link, redirect, useNavigation } from "react-router";
import { createPerson, listPeopleAdmin } from "~/lib/people.server";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ViewPublicPage } from "~/components/view-public";
import { initials } from "~/components/public/public-layout";

// Hosts & guests: the public profiles (headshot, bio, website). People are created
// automatically when credited on an episode; this screen is where they get a face
// and a bio, and where you can add someone ahead of time.
export async function loader() {
  const data = listPeopleAdmin();
  if (!data) throw new Response("No show seeded yet", { status: 404 });
  return data;
}

export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  const r = createPerson(String(form.get("name") ?? ""), String(form.get("role") ?? ""));
  if (!r.ok) return { error: r.error };
  return redirect(`/studio/people/${r.id}`);
}

export default function People({
  loaderData,
  actionData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
  actionData?: { error?: string };
}) {
  const { people } = loaderData;
  const nav = useNavigation();
  const hosts = people.filter((p) => p.role === "host");
  const others = people.filter((p) => p.role !== "host");

  const Row = ({ p }: { p: (typeof people)[number] }) => (
    <li>
      <Link
        to={`/studio/people/${p.id}`}
        className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 hover:bg-accent/40"
      >
        {p.avatarUrl ? (
          <img src={p.avatarUrl} alt="" className="size-10 rounded-full object-cover" />
        ) : (
          <span className="flex size-10 items-center justify-center rounded-full bg-secondary text-[12px] font-bold text-muted-foreground">
            {initials(p.name)}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{p.name}</span>
          <span className="text-[12.5px] capitalize text-muted-foreground">
            {p.role ?? "No role"} · {p.episodes} episode{p.episodes === 1 ? "" : "s"}
          </span>
        </span>
        <span className={p.onPublicSite ? "text-xs text-ok" : "text-xs text-muted-foreground"}>
          {p.onPublicSite ? "On public site" : "Not public yet"}
        </span>
      </Link>
    </li>
  );

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">Public page &amp; embeds</div>
          <h1 className="text-2xl font-semibold tracking-tight">Hosts &amp; guests</h1>
          <p className="mt-1 max-w-xl text-[13px] text-muted-foreground">
            Hosts always appear on your public page. A guest appears only once they're credited on a published, public
            episode — never because of a draft.
          </p>
        </div>
        <ViewPublicPage />
      </div>

      {people.length === 0 && (
        <p className="mb-4 text-[13px] text-muted-foreground">
          Nobody yet. People are added when you credit them on an episode, or add one below.
        </p>
      )}
      {hosts.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Hosts</h2>
          <ul className="flex flex-col gap-2">{hosts.map((p) => <Row key={p.id} p={p} />)}</ul>
        </section>
      )}
      {others.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Guests &amp; others</h2>
          <ul className="flex flex-col gap-2">{others.map((p) => <Row key={p.id} p={p} />)}</ul>
        </section>
      )}

      <Form method="post" className="flex flex-wrap items-end gap-3 rounded-[14px] border border-border bg-card p-4">
        <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <Label htmlFor="new-name">Add a person</Label>
          <Input id="new-name" name="name" required maxLength={120} placeholder="Name" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-role">Role</Label>
          <select
            id="new-role"
            name="role"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="host" className="bg-popover">Host</option>
            <option value="guest" className="bg-popover">Guest</option>
          </select>
        </div>
        <Button type="submit" disabled={nav.state === "submitting"}>
          Add
        </Button>
        {actionData?.error && <p className="w-full text-[13px] text-destructive">{actionData.error}</p>}
      </Form>
    </div>
  );
}
