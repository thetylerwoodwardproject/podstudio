import { useState } from "react";
import { Link } from "react-router";
import { Check, Copy } from "lucide-react";
import { getFeedOverview } from "~/lib/feed.server";
import { POD20_TOTAL } from "~/lib/feed-check";
import { cn } from "~/lib/utils";

// Screen 15 (Podcast hosting / Feed overview), laid out after the mockup: RSS
// URL card with Copy, a Podcast 1.0 and a Podcasting 2.0 card, the episodes in
// the feed, and a Directories card. Everything shown is read from the real feed:
// the validity cards come from lib/feed-check.ts run over the XML we actually
// serve (our own self-check, not Apple's validator). Not in the mockup because
// there is nothing real behind it yet: the "Hosting on" switch (no such setting),
// per-directory status (needs the Podcast Index integration), Import feed.
//
// This file imports nothing from @podstudio/db or drizzle-orm — see
// feed.server.ts and CHANGELOG, "Real bug: two sidebar links silently
// failed to navigate," for why that's a hard rule now, not just tidiness.
const DIRECTORIES = ["Apple Podcasts", "Spotify", "Podcast Index", "YouTube Music", "Amazon Music", "Pocket Casts"];

function formatDuration(s: number | null) {
  if (s == null) return null;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatAgo(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export async function loader({ request }: { request: Request }) {
  const overview = getFeedOverview(new URL(request.url).origin);
  if (!overview) throw new Response("No show seeded yet", { status: 404 });
  return overview;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the URL is selectable in the field */
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3.5 text-[13px] font-bold text-background hover:opacity-90"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function Verdict({ ok }: { ok: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12px]", ok ? "text-ok" : "text-destructive")}>
      <span className={cn("size-1.5 rounded-full", ok ? "bg-ok" : "bg-destructive")} />
      {ok ? "Valid" : "Needs attention"}
    </span>
  );
}

export default function FeedOverview({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { show, feedUrl, feedBytes, lastEpisodeAt, check, inFeed, notInFeed } = loaderData;
  const ok1 = check.errors.length === 0;

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-[280px] flex-1">
          <h1 className="text-[32px] font-bold leading-tight tracking-[-0.025em]">Podcast hosting</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your RSS feed is served from this server. Media files live in your own bucket.
          </p>
        </div>
        <div className="flex gap-4 text-[12.5px] text-muted-foreground">
          <Link to="/studio/feed/tags" className="hover:text-foreground hover:underline">
            Show tags
          </Link>
          <Link to="/studio/feed/lock-verify" className="hover:text-foreground hover:underline">
            Lock &amp; verify
          </Link>
          <Link to="/studio/storage" className="hover:text-foreground hover:underline">
            Storage
          </Link>
          {/* Plain <a>: the feed is an XML resource route, not a client-navigable page. */}
          <a href={`/${show.slug}/feed`} className="hover:text-foreground hover:underline">
            View feed XML
          </a>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[2.2fr_1fr_1fr]">
        <section className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-[18px]">
          <div className="text-xs text-muted-foreground">RSS feed URL · submit this to directories</div>
          <div className="flex gap-2">
            <input
              readOnly
              value={feedUrl}
              aria-label="RSS feed URL"
              onFocus={(e) => e.currentTarget.select()}
              className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 font-mono text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <CopyButton text={feedUrl} />
          </div>
          <div className="font-mono text-[11px] font-medium text-muted-foreground" data-testid="feed-stats">
            {lastEpisodeAt ? `last episode ${formatAgo(lastEpisodeAt)}` : "no episodes yet"} · {check.items} item
            {check.items === 1 ? "" : "s"} · {formatBytes(feedBytes)} · served by Caddy
          </div>
        </section>

        <section className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-[18px]">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            Podcast 1.0 <Verdict ok={ok1} />
          </div>
          <div className="text-[17px] font-semibold">{ok1 ? "Apple & Spotify ready" : "Not ready for directories"}</div>
          <div className="text-xs text-muted-foreground" data-testid="v1-count">
            {check.errors.length} error{check.errors.length === 1 ? "" : "s"} · {check.warnings.length} warning
            {check.warnings.length === 1 ? "" : "s"}
          </div>
          <div className="text-[11px] text-muted-foreground">Checked by Podstudio, not by Apple.</div>
        </section>

        <section className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-[18px]">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            Podcasting 2.0
          </div>
          <div className="text-[17px] font-semibold" data-testid="v2-count">
            {check.podcast20.length} of {POD20_TOTAL} tags in use
          </div>
          <div className="text-xs text-muted-foreground">
            Plus per-episode tags ·{" "}
            <Link to="/studio/feed/tags" className="text-foreground hover:underline">
              Edit tags
            </Link>
          </div>
        </section>
      </div>

      {(check.errors.length > 0 || check.warnings.length > 0) && (
        <section className="mt-3 rounded-xl border border-border bg-card p-[18px]" data-testid="feed-problems">
          <ul className="flex flex-col gap-2 text-[13px]">
            {[...check.errors.map((i) => ({ i, bad: true })), ...check.warnings.map((i) => ({ i, bad: false }))].map(({ i, bad }) => (
              <li key={i.message} className="flex flex-wrap items-baseline gap-x-2">
                <span className={cn("size-1.5 shrink-0 translate-y-[-1px] rounded-full", bad ? "bg-destructive" : "bg-music")} />
                <span className={bad ? "" : "text-muted-foreground"}>{i.message}</span>
                <Link to={i.fix.to} className="text-[12.5px] text-foreground underline underline-offset-2 hover:no-underline">
                  Fix it in {i.fix.label} →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.9fr_1fr]">
        <section>
          <div className="mb-2.5 flex items-baseline justify-between text-xs uppercase tracking-[0.08em] text-muted-foreground">
            <span>In your feed</span>
            <span className="normal-case tracking-normal">Newest first</span>
          </div>
          {inFeed.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-5 text-[13px] text-muted-foreground">
              Nothing is in the feed yet. An episode appears here once it has a verified MP3 and is published.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {inFeed.map((ep) => (
                <Link
                  key={ep.id}
                  to={`/studio/episodes/${ep.id}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 hover:bg-accent/40"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary font-mono text-[12.5px] text-muted-foreground">
                    {ep.number ?? "–"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{ep.title}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {[
                        ep.season != null ? `S${ep.season}` : null,
                        formatDuration(ep.durationS),
                        ep.bytes != null ? formatBytes(ep.bytes) : null,
                        "MP3",
                      ]
                        .filter(Boolean)
                        .map((b) => (
                          <span key={b} className="rounded bg-secondary px-1.5 py-px font-mono text-[10.5px] text-muted-foreground">
                            {b}
                          </span>
                        ))}
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-xs text-ok">
                    <span className="size-1.5 rounded-full bg-ok" />
                    Live
                  </span>
                </Link>
              ))}
            </div>
          )}
          {notInFeed > 0 && (
            <p className="mt-2.5 text-[12.5px] text-muted-foreground">
              {notInFeed} other episode{notInFeed === 1 ? " isn't" : "s aren't"} in the feed (recording, editing, scheduled
              or unpublished).{" "}
              <Link to="/studio/episodes" className="text-foreground hover:underline">
                View all episodes
              </Link>
            </p>
          )}
        </section>

        <section>
          <div className="mb-2.5 text-xs uppercase tracking-[0.08em] text-muted-foreground">Directories</div>
          <div className="flex flex-col gap-2">
            {DIRECTORIES.map((d) => (
              <div key={d} className="flex items-center justify-between rounded-xl border border-border bg-card px-3.5 py-2.5 text-[13px] font-medium">
                {d}
                <span className="text-xs font-normal text-muted-foreground">Not tracked yet</span>
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground">
            Submit the feed URL to each directory yourself. Submission status will show here once the Podcast Index
            integration exists.
          </p>
        </section>
      </div>
    </div>
  );
}
