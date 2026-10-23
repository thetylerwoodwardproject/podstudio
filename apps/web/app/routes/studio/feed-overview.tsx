import { Link } from "react-router";
import { getFeedOverview } from "~/lib/feed.server";
import { StatusBadge } from "~/components/ui/status-badge";
import { Separator } from "~/components/ui/separator";

// Screen 15 (Feed overview). Per README: "Sidebar, Cards for downloads/
// listeners, Chart (Recharts), Table of recent episodes." The downloads/
// listeners cards and chart need OP3 analytics data, which doesn't exist —
// no OP3 integration, no `analytics_daily` table (that's Stage 11). Rather
// than fake numbers or ship an empty-looking chart, that whole area is one
// honest "not available yet" note. The cards slot instead holds something
// genuinely real: episode counts by status. Table of recent episodes is
// real, from the actual episodes table.
//
// This file imports nothing from @podstudio/db or drizzle-orm — see
// feed.server.ts and CHANGELOG, "Real bug: two sidebar links silently
// failed to navigate," for why that's a hard rule now, not just tidiness.
const STATUS_META = {
  recording: { label: "Recording", classes: "bg-destructive/15 text-destructive" },
  editing: { label: "Editing", classes: "bg-accent text-accent-foreground" },
  scheduled: { label: "Scheduled", classes: "bg-music/15 text-music" },
  published: { label: "Published", classes: "bg-ok/15 text-ok" },
} as const;
const STATUS_LIST = Object.keys(STATUS_META) as (keyof typeof STATUS_META)[];

function formatDuration(s: number | null) {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function formatRelative(ms: number) {
  const diff = Date.now() - ms;
  const days = Math.floor(diff / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

export async function loader() {
  const overview = getFeedOverview();
  if (!overview) throw new Response("No show seeded yet", { status: 404 });
  return overview;
}

export default function FeedOverview({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
}) {
  const { show, recent, statusCounts } = loaderData;
  const countByStatus = new Map(statusCounts.map((c) => [c.status, c.n]));

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-5 flex items-baseline justify-between">
        <div>
          <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
            Podcast hosting
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{show.title}</h1>
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

      <div className="grid grid-cols-4 gap-3">
        {STATUS_LIST.map((s) => (
          <div key={s} className="rounded-[14px] border border-border bg-card p-4">
            <div className={`mb-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_META[s].classes}`}>
              {STATUS_META[s].label}
            </div>
            <div className="text-2xl font-semibold tabular-nums">{countByStatus.get(s) ?? 0}</div>
          </div>
        ))}
      </div>

      <section className="mt-6 rounded-[14px] border border-border bg-card p-5">
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Downloads &amp; listeners</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Not available yet — this needs an OP3 analytics integration that
          hasn't been built (Stage 11). Showing fabricated numbers here would
          be worse than showing nothing, so there's nothing here until that
          data is real.
        </p>
      </section>

      <Separator className="my-6" />

      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Recent episodes</h2>
        <Link to="/studio/episodes" className="text-[12.5px] text-muted-foreground hover:text-foreground hover:underline">
          View all
        </Link>
      </div>

      {recent.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">No episodes yet.</p>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[12.5px] text-muted-foreground">
                <th className="px-3 py-2">Episode</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Length</th>
                <th className="px-3 py-2">Edited</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((ep) => (
                <tr key={ep.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2.5">
                    <Link to={`/studio/episodes/${ep.id}`} className="hover:underline">
                      {ep.number != null ? `${ep.number}. ` : ""}
                      {ep.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={ep.status} />
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[12.5px]">{formatDuration(ep.durationS)}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{formatRelative(ep.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
