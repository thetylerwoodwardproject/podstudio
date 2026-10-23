import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { PLATFORM_LABELS, PLATFORM_LIST, PLATFORM_ICONS, type Platform } from "~/lib/platforms";
import {
  getShowWebsite,
  listShowLinks,
  addShowLink,
  removeShowLink,
  setShowLinkVisible,
  moveShowLink,
} from "~/lib/public-links.server";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";

// Screen 29 (Public page links). Per README: "website (also written to the
// feed's <link>), plus a sortable list of social links... 'Add link' opens
// a platform picker... each platform is used at most once." Scoped down:
// - Website is shown read-only, linking to Show tags (16) — it's already a
//   real field there (`shows.website`); editing it twice would just invite
//   the two forms to disagree.
// - Reordering is plain up/down buttons, not dnd-kit drag-and-drop — same
//   kind of practical substitution as screen 02's hand-built table instead
//   of TanStack, or screen 17's plain radio inputs instead of RadioGroup.
// - Platform icons use Font Awesome 6 Free brands per CLAUDE.md ("Icons:
//   Font Awesome 6 Free (solid + brands), imported one by one"), not
//   lucide-react — lucide only covers half the 12 platforms. Each icon is
//   imported from its own subpath (`free-brands-svg-icons/faXxx`), not the
//   package barrel, so unused brand icons don't end up in the bundle.
// - The spec's "live preview" of the actual hero-link-row/footer layout
//   needs the public page itself (screen 25), which doesn't exist yet —
//   this screen is the structured data, not a rendered mockup of it.
// - Host/guest personal websites+socials (the `people` table's own
//   columns) are a separate, already-deferred concern — this is show-level
//   links only.
//
// This file imports nothing from @podstudio/db or drizzle-orm — all of
// that lives in public-links.server.ts. See CHANGELOG, "Real bug: two
// sidebar links silently failed to navigate," for why that's a hard rule.
// Platforms with a stable 1:1 handle -> profile-URL mapping get normalized
// from a bare handle. Discord (invite links, not handles) and LinkedIn
// (personal /in/ vs. company /company/ profiles aren't distinguishable
// from a handle alone) require a full URL instead of guessing wrong.
const HANDLE_BASE_URL: Partial<Record<Platform, string>> = {
  instagram: "https://instagram.com/",
  youtube: "https://youtube.com/@",
  tiktok: "https://tiktok.com/@",
  bluesky: "https://bsky.app/profile/",
  threads: "https://threads.net/@",
  x: "https://x.com/",
  facebook: "https://facebook.com/",
  twitch: "https://twitch.tv/",
  patreon: "https://patreon.com/",
};

function isValidUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeLinkValue(
  platform: Platform,
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim();
  if (!value) return { ok: false, error: "A handle or URL is required." };
  if (isValidUrl(value)) return { ok: true, value };

  if (platform === "mastodon") {
    // @user@instance.tld -> https://instance.tld/@user
    const match = value.match(/^@?([^@\s]+)@([^@\s]+)$/);
    if (!match) {
      return {
        ok: false,
        error: "Mastodon needs either a full profile URL or @user@instance.tld.",
      };
    }
    return { ok: true, value: `https://${match[2]}/@${match[1]}` };
  }

  const base = HANDLE_BASE_URL[platform];
  if (!base) {
    return {
      ok: false,
      error: `${PLATFORM_LABELS[platform]} needs a full profile URL — its handle format can't be guessed reliably.`,
    };
  }
  return { ok: true, value: base + value.replace(/^@/, "") };
}

export async function loader() {
  return { website: getShowWebsite(), links: listShowLinks() };
}

export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  const intent = form.get("intent");
  const str = (name: string) => ((form.get(name) as string) || "").trim();

  if (intent === "add-link") {
    const platform = str("platform") as Platform;
    const normalized = normalizeLinkValue(platform, str("value"));
    if (!normalized.ok) return { error: normalized.error };

    const result = addShowLink(platform, normalized.value);
    if (!result.ok) return { error: result.error };
    return { added: true };
  }

  if (intent === "remove-link") {
    removeShowLink(str("id"));
    return { removed: true };
  }

  if (intent === "toggle-visible") {
    setShowLinkVisible(str("id"), str("visible") === "true");
    return { toggled: true };
  }

  if (intent === "move-link") {
    moveShowLink(str("id"), str("direction") as "up" | "down");
    return { moved: true };
  }

  return null;
}

export default function PublicLinks({
  loaderData,
  actionData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
  actionData?: { error?: string; added?: boolean };
}) {
  const { website, links } = loaderData;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [platform, setPlatform] = useState<Platform>(PLATFORM_LIST[0]);

  const usedPlatforms = new Set(links.map((l) => l.platform));
  const availablePlatforms = PLATFORM_LIST.filter((p) => !usedPlatforms.has(p));
  // `platform` state can go stale after a successful add revalidates this
  // list (the platform just added drops out of `availablePlatforms`) — a
  // plain uncontrolled/stale `platform` would then mismatch what the native
  // <select> actually falls back to showing (its first remaining <option>).
  // Deriving the effective value here keeps the icon preview and the select
  // showing the same platform always, instead of drifting apart.
  const effectivePlatform = availablePlatforms.includes(platform)
    ? platform
    : availablePlatforms[0];

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-5">
        <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
          Public page &amp; embeds
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Public page links</h1>
        <Link to="/studio/public/brand" className="text-[12.5px] text-muted-foreground underline hover:text-foreground">
          Brand &amp; theme
        </Link>
      </div>

      <section className="flex flex-col gap-2 rounded-[14px] border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-muted-foreground">Website</h2>
        <div className="flex items-center justify-between text-[13px]">
          <span className="font-mono text-[12.5px]">{website ?? "(not set)"}</span>
          <Link to="/studio/feed/tags" className="text-muted-foreground underline hover:text-foreground">
            Edit in Show tags
          </Link>
        </div>
      </section>

      <section className="mt-6 flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-muted-foreground">Social links</h2>

        {links.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">No social links yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {links.map((l, i) => (
              <li
                key={l.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-[13px]"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <FontAwesomeIcon
                    icon={PLATFORM_ICONS[l.platform as Platform]}
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  />
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">{PLATFORM_LABELS[l.platform as Platform]}</span>
                    <a
                      href={l.value}
                      target="_blank"
                      rel="me noopener"
                      className="truncate font-mono text-[12px] text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {l.value}
                    </a>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Form method="post">
                    <input type="hidden" name="intent" value="move-link" />
                    <input type="hidden" name="id" value={l.id} />
                    <input type="hidden" name="direction" value="up" />
                    <Button type="submit" variant="ghost" size="sm" disabled={submitting || i === 0}>
                      ↑
                    </Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="move-link" />
                    <input type="hidden" name="id" value={l.id} />
                    <input type="hidden" name="direction" value="down" />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      disabled={submitting || i === links.length - 1}
                    >
                      ↓
                    </Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="toggle-visible" />
                    <input type="hidden" name="id" value={l.id} />
                    <input type="hidden" name="visible" value={(!l.visible).toString()} />
                    <Button type="submit" variant="outline" size="sm" disabled={submitting}>
                      {l.visible ? "Shown" : "Hidden"}
                    </Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="remove-link" />
                    <input type="hidden" name="id" value={l.id} />
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

        {availablePlatforms.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            All {PLATFORM_LIST.length} platforms are added. Remove one to add a different one.
          </p>
        ) : (
          <Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="intent" value="add-link" />
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="platform">Platform</Label>
                <div className="flex items-center gap-2">
                  <FontAwesomeIcon
                    icon={PLATFORM_ICONS[effectivePlatform]}
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                  />
                  <select
                    id="platform"
                    name="platform"
                    value={effectivePlatform}
                    onChange={(e) => setPlatform(e.target.value as Platform)}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {availablePlatforms.map((p) => (
                      <option key={p} value={p}>
                        {PLATFORM_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="value">Handle or URL</Label>
                <Input id="value" name="value" placeholder="@handle or full URL" required />
              </div>
            </div>

            {actionData?.error && <p className="text-[13px] text-destructive">{actionData.error}</p>}
            {actionData?.added && <p className="text-[13px] text-ok">Added.</p>}

            <div>
              <Button type="submit" disabled={submitting}>
                Add link
              </Button>
            </div>
          </Form>
        )}
      </section>
    </div>
  );
}
