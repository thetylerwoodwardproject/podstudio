import { ViewPublicPage } from "~/components/view-public";
import { Form, useNavigation } from "react-router";
import {
  getPodroll,
  addPodrollItem,
  removePodrollItem,
  movePodrollItem,
  setShowPodrollOnPublicPage,
} from "~/lib/podroll.server";
import { podrollXml } from "~/lib/podroll-xml";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";

// Screen 32 (Podroll, admin). Per README: search Podcast Index, Add/Added
// toggles; a sortable, removable list with a verified-GUID check; a live
// preview of the <podcast:podroll> block; "Show on public page" switch that
// controls the "Shows we recommend" section on 25. Order = feed = page order.
// Real: manual add (title + required podcast:guid UUID, optional feed URL and
// note), duplicate/own-GUID rejection, reorder (up/down, not drag), remove,
// the XML preview (shared builder in lib/podroll-xml.ts), the public-page
// switch, and the "Shows we recommend" section on the public show page.
// Deferred, stated on the screen: Podcast Index search and the verified-GUID
// check need a Podcast Index API key/integration (Stage 11); every item is
// shown as unverified. No db imports here — see podroll.server.ts.
export async function loader() {
  return { podroll: getPodroll() };
}

export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  const intent = form.get("intent");
  const str = (n: string) => ((form.get(n) as string) || "").trim();

  if (intent === "add-item") {
    const result = addPodrollItem({
      title: str("title"),
      feedGuid: str("feedGuid"),
      feedUrl: str("feedUrl"),
      note: str("note"),
    });
    if (!result.ok) return { error: result.error };
    return { added: true };
  }
  if (intent === "remove-item") {
    removePodrollItem(str("id"));
    return { removed: true };
  }
  if (intent === "move-item") {
    movePodrollItem(str("id"), str("direction") === "up" ? "up" : "down");
    return { moved: true };
  }
  if (intent === "toggle-public") {
    setShowPodrollOnPublicPage(str("value") === "true");
    return { toggled: true };
  }
  return null;
}

export default function Podroll({
  loaderData,
  actionData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
  actionData?: { error?: string; added?: boolean };
}) {
  const { podroll } = loaderData;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  if (!podroll) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Podroll</h1>
        <p className="mt-4 text-[13px] text-muted-foreground">No show seeded yet.</p>
      </div>
    );
  }
  const { items, showOnPublicPage } = podroll;
  const xml = podrollXml(items);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
            Analytics &amp; discovery
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Podroll</h1>
        </div>
        <ViewPublicPage />
      </div>

      <section className="flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-muted-foreground">Recommended shows</h2>
        {items.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">No shows on the podroll yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((i, idx) => (
              <li key={i.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-[13px]" data-testid="podroll-item">
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">{i.title}</span>
                  <span className="truncate font-mono text-[11.5px] text-muted-foreground">{i.feedGuid}</span>
                  {i.note && <span className="text-[12px] text-muted-foreground">{i.note}</span>}
                  <span className="text-[11.5px] text-muted-foreground">
                    {i.verifiedAt ? "GUID verified" : "Unverified — Podcast Index check isn't connected"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {(["up", "down"] as const).map((dir) => (
                    <Form method="post" key={dir}>
                      <input type="hidden" name="intent" value="move-item" />
                      <input type="hidden" name="id" value={i.id} />
                      <input type="hidden" name="direction" value={dir} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        aria-label={`Move ${dir}`}
                        disabled={submitting || (dir === "up" ? idx === 0 : idx === items.length - 1)}
                      >
                        {dir === "up" ? "↑" : "↓"}
                      </Button>
                    </Form>
                  ))}
                  <Form method="post">
                    <input type="hidden" name="intent" value="remove-item" />
                    <input type="hidden" name="id" value={i.id} />
                    <Button type="submit" variant="ghost" size="sm" disabled={submitting}>
                      Remove
                    </Button>
                  </Form>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Separator />

        <Form method="post" className="flex flex-col gap-3">
          <input type="hidden" name="intent" value="add-item" />
          <p className="text-[12.5px] text-muted-foreground">
            Podcast Index search isn't connected (it needs an API key — Stage 11), so add a show by hand.
            Its <code className="font-mono">podcast:guid</code> is required.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="feedGuid">podcast:guid</Label>
              <Input id="feedGuid" name="feedGuid" placeholder="917393e3-1b1e-5cef-ace4-edaa54e1f810" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="feedUrl">Feed URL (optional)</Label>
              <Input id="feedUrl" name="feedUrl" placeholder="https://example.com/feed.xml" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="note">Note (optional)</Label>
              <Input id="note" name="note" maxLength={500} />
            </div>
          </div>
          {actionData?.error && <p className="text-[13px] text-destructive">{actionData.error}</p>}
          {actionData?.added && <p className="text-[13px] text-ok">Added.</p>}
          <div>
            <Button type="submit" disabled={submitting}>
              Add to podroll
            </Button>
          </div>
        </Form>
      </section>

      <section className="mt-5 flex flex-col gap-3 rounded-[14px] border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-muted-foreground">Feed preview</h2>
        {xml ? (
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-[12px]" data-testid="podroll-xml">
            {xml}
          </pre>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">Nothing to write to the feed yet.</p>
        )}
        <p className="text-[11.5px] text-muted-foreground">
          Order here is the feed order and the public-page order. The feed itself isn't generated yet.
        </p>
      </section>

      <section className="mt-5 rounded-[14px] border border-border bg-card p-5">
        <Form method="post" className="flex items-center gap-2 text-[13px]">
          <input type="hidden" name="intent" value="toggle-public" />
          <input type="hidden" name="value" value={(!showOnPublicPage).toString()} />
          <Button type="submit" variant="outline" size="sm" disabled={submitting} role="switch" aria-checked={showOnPublicPage}>
            {showOnPublicPage ? "On" : "Off"}
          </Button>
          <span>Show on public page ("Shows we recommend")</span>
        </Form>
      </section>
    </div>
  );
}
