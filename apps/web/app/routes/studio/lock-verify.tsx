import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { eq, and } from "drizzle-orm";
import { db, shows, showTxtRecords } from "@podstudio/db";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { HelpPopover, HelpTerm } from "~/components/ui/help-popover";

// Screen 16b (Lock & verify). Per README: feed lock is consent-gated to
// unlock (6-digit code to the verified owner email) — that whole flow is
// deliberately NOT built here, since it needs email delivery, still an open
// STATUS.md "Outstanding input." Locking (the safe direction — it only makes
// the feed harder for other hosts to import, never destructive) doesn't need
// email, so that part is real. TXT records are the other half of this screen
// and are fully real. Not built: unlock, the audit log the real flow would
// write to, and the live feed preview (no feed XML renderer exists yet at
// any stage).
const PRESETS = [
  { value: "applepodcastsverify", label: "Apple Podcasts verify (ownership code)" },
  { value: "verify", label: "Verify (other platforms)" },
  { value: "ai-content", label: "AI content disclosure" },
  { value: "custom", label: "Custom" },
] as const;

const PURPOSE_MAX = 128;
const VALUE_MAX = 4000;

export async function loader() {
  const show = db.select().from(shows).get();
  if (!show) throw new Response("No show seeded yet", { status: 404 });

  const txtRecords = db
    .select()
    .from(showTxtRecords)
    .where(eq(showTxtRecords.showId, show.id))
    .orderBy(showTxtRecords.createdAt)
    .all();

  return { show, txtRecords };
}

export async function action({ request }: { request: Request }) {
  const show = db.select().from(shows).get();
  if (!show) throw new Response("No show seeded yet", { status: 404 });

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "lock") {
    db.update(shows)
      .set({ locked: 1, unlockedUntil: null })
      .where(eq(shows.id, show.id))
      .run();
    return { locked: true };
  }

  if (intent === "remove-txt") {
    const id = String(form.get("id") ?? "");
    db.delete(showTxtRecords)
      .where(and(eq(showTxtRecords.id, id), eq(showTxtRecords.showId, show.id)))
      .run();
    return { removed: true };
  }

  if (intent === "add-txt") {
    const preset = String(form.get("preset") ?? "custom");
    const purpose =
      preset === "custom" ? (form.get("customPurpose") as string) || null : preset;
    const value = String(form.get("value") ?? "").trim();

    if (purpose && purpose.length > PURPOSE_MAX) {
      return { error: `Purpose must be ${PURPOSE_MAX} characters or fewer.` };
    }
    if (!value) {
      return { error: "Value is required." };
    }
    if (value.length > VALUE_MAX) {
      return { error: `Value must be ${VALUE_MAX} characters or fewer.` };
    }

    db.insert(showTxtRecords)
      .values({ id: crypto.randomUUID(), showId: show.id, purpose, value })
      .run();
    return { added: true };
  }

  return null;
}

export default function LockVerify({
  loaderData,
  actionData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
  actionData?: { locked?: boolean; removed?: boolean; added?: boolean; error?: string };
}) {
  const { show, txtRecords } = loaderData;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [preset, setPreset] = useState<string>("applepodcastsverify");

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-5 flex items-baseline justify-between">
        <div>
          <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
            {show.title}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Lock &amp; verify</h1>
        </div>
        <Link
          to="/studio/feed/tags"
          className="text-[12.5px] text-muted-foreground hover:text-foreground hover:underline"
        >
          Back to show tags
        </Link>
      </div>

      <section className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-muted-foreground">Feed lock</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Locking asks other podcast hosts not to import this feed. It can't stop
          anyone from downloading already-public episodes.
        </p>

        <div className="flex items-center justify-between">
          <span className="text-[13px]">
            Currently{" "}
            <strong className="font-mono">{show.locked ? "locked" : "unlocked"}</strong>
            {show.unlockedUntil ? (
              <span className="text-muted-foreground">
                {" "}
                — unlocked until {new Date(show.unlockedUntil).toLocaleString()}
              </span>
            ) : null}
          </span>

          {show.locked ? (
            <Button type="button" variant="outline" size="sm" disabled title="Unlocking needs owner-email verification — deferred until email delivery is chosen">
              Request unlock
            </Button>
          ) : (
            <Form method="post">
              <input type="hidden" name="intent" value="lock" />
              <Button type="submit" variant="outline" size="sm" disabled={submitting}>
                Lock now
              </Button>
            </Form>
          )}
        </div>

        <p className="text-[12.5px] text-muted-foreground">
          Unlocking is deferred: it requires a verified owner email and a 6-digit
          code sent to it, and this build has no email delivery configured yet
          (see <code className="font-mono">STATUS.md</code>'s outstanding inputs).
          Locking doesn't need email, so it's real above. Lock/unlock audit
          logging arrives with the real unlock flow.
        </p>
      </section>

      <section className="mt-6 flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">TXT records</h2>
          <HelpPopover label="TXT records">
            <HelpTerm term="TXT record">
              A small <code>&lt;podcast:txt&gt;</code> tag on the show feed, used
              for one-off verification codes (prove you own the feed to a
              directory) or short disclosures. An optional{" "}
              <code>purpose</code> attribute says what kind it is.
            </HelpTerm>
            <HelpTerm term="Apple Podcasts verify">
              The ownership code Apple gives you to paste into the feed so it can
              confirm you control the show.
            </HelpTerm>
            <HelpTerm term="AI content disclosure">
              <code>true</code>/<code>false</code> flag disclosing AI-generated
              content at the show level. Stage 07 adds a per-episode override.
            </HelpTerm>
          </HelpPopover>
        </div>

        {txtRecords.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">No TXT records yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {txtRecords.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-[13px]"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-mono text-[12px] text-muted-foreground">
                    {r.purpose ?? "(no purpose)"}
                  </span>
                  <span className="truncate">{r.value}</span>
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="remove-txt" />
                  <input type="hidden" name="id" value={r.id} />
                  <Button type="submit" variant="ghost" size="sm" disabled={submitting}>
                    Remove
                  </Button>
                </Form>
              </li>
            ))}
          </ul>
        )}

        <Separator />

        <Form method="post" className="flex flex-col gap-3">
          <input type="hidden" name="intent" value="add-txt" />
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="preset">Preset</Label>
              <select
                id="preset"
                name="preset"
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
                className="rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {preset === "custom" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customPurpose">Purpose (optional)</Label>
                <Input id="customPurpose" name="customPurpose" maxLength={PURPOSE_MAX} />
              </div>
            )}
          </div>

          {preset === "ai-content" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="value">Value</Label>
              <select
                id="value"
                name="value"
                defaultValue="true"
                className="rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="value">Value</Label>
              <Input
                id="value"
                name="value"
                maxLength={VALUE_MAX}
                placeholder={preset === "custom" ? "" : "code from the platform"}
                required
              />
            </div>
          )}

          {actionData?.error && (
            <p className="text-[13px] text-destructive">{actionData.error}</p>
          )}
          {actionData?.added && <p className="text-[13px] text-ok">Added.</p>}

          <div>
            <Button type="submit" disabled={submitting}>
              Add TXT record
            </Button>
          </div>
        </Form>
      </section>
    </div>
  );
}
