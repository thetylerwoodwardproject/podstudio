import { Form, useNavigation, useSearchParams } from "react-router";
import { getAnalyticsContext, setShowOnPublicPage } from "~/lib/analytics.server";
import { Button } from "~/components/ui/button";

// Screen 31 (Analytics, admin). Per README: range control (30 days daily /
// 90 days weekly / 12 months monthly); KPIs; downloads chart; top apps;
// per-episode table (Day 1 / 7 / 30 / all time); countries; a "Show overview
// on public page" switch; OP3 / Podcast Index status bottom right.
// Every number on that list comes from OP3, which isn't integrated (no
// `analytics_daily` table, no OP3 token, no prefixed feed — Stage 11), so
// like screen 15 this refuses to fabricate any of it. What's real:
// - the range control (URL state, `?range=`) and the labelled granularity;
// - the per-episode table's rows (real published episodes, real publish
//   dates) with the download columns marked "No data";
// - the "Show overview on public page" switch, persisted under
//   `shows.settings.analytics` — screen 25 doesn't exist to read it yet;
// - OP3 / Podcast Index status, honestly "Not connected".
// This file imports nothing from @podstudio/db — see analytics.server.ts.
const RANGES = [
  { id: "30d", label: "30 days", granularity: "daily" },
  { id: "90d", label: "90 days", granularity: "weekly" },
  { id: "12m", label: "12 months", granularity: "monthly" },
] as const;

const KPIS = ["Downloads", "Avg per episode (7 days)", "Avg per episode (30 days)", "Countries"];
const NO_DATA = "No data";

export async function loader() {
  return { ctx: getAnalyticsContext() };
}

export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  if (form.get("intent") === "toggle-public-overview") {
    setShowOnPublicPage(form.get("value") === "true");
    return { toggled: true };
  }
  return null;
}

function formatDate(ms: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function Unavailable({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-border px-4 py-5 text-center text-[13px] text-muted-foreground">
      {children}
    </p>
  );
}

export default function Analytics({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { ctx } = loaderData;
  const [params, setParams] = useSearchParams();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const range = RANGES.find((r) => r.id === params.get("range")) ?? RANGES[0];

  if (!ctx) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-4 text-[13px] text-muted-foreground">No show seeded yet.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
            Analytics &amp; discovery
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        </div>
        <div role="group" aria-label="Range" className="flex gap-1">
          {RANGES.map((r) => (
            <Button
              key={r.id}
              type="button"
              size="sm"
              variant={r.id === range.id ? "outline" : "ghost"}
              aria-pressed={r.id === range.id}
              onClick={() => setParams({ range: r.id }, { replace: true, preventScrollReset: true })}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      <Unavailable>
        Download statistics aren't available yet — they come from OP3, which isn't connected (it needs
        an OP3 token and the feed served through OP3's prefix; Stage 11). Nothing below is estimated or
        sample data.
      </Unavailable>

      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {KPIS.map((k) => (
          <div key={k} className="rounded-[14px] border border-border bg-card p-4">
            <div className="text-[12px] text-muted-foreground">{k}</div>
            <div className="mt-1 text-[15px] text-muted-foreground">{NO_DATA}</div>
          </div>
        ))}
      </section>

      <section className="mt-5 flex flex-col gap-3 rounded-[14px] border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Downloads — {range.label}, {range.granularity}
        </h2>
        <Unavailable>No downloads data to chart.</Unavailable>
      </section>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-muted-foreground">Top apps</h2>
          <Unavailable>{NO_DATA}</Unavailable>
        </section>
        <section className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-muted-foreground">Countries</h2>
          <Unavailable>{NO_DATA}</Unavailable>
        </section>
      </div>

      <section className="mt-5 flex flex-col gap-3 rounded-[14px] border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-muted-foreground">Episodes</h2>
        {ctx.published.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">No published episodes yet.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-muted-foreground">
                <th className="pb-2 font-medium">Episode</th>
                <th className="pb-2 font-medium">Published</th>
                <th className="pb-2 text-right font-medium">Day 1</th>
                <th className="pb-2 text-right font-medium">Day 7</th>
                <th className="pb-2 text-right font-medium">Day 30</th>
                <th className="pb-2 text-right font-medium">All time</th>
              </tr>
            </thead>
            <tbody>
              {ctx.published.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="py-2 pr-3">
                    {e.number != null ? `Ep. ${e.number} — ` : ""}
                    {e.title}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{formatDate(e.publishAt)}</td>
                  {[0, 1, 2, 3].map((i) => (
                    <td key={i} className="py-2 text-right text-muted-foreground">
                      —
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-[11.5px] text-muted-foreground">
          Day 1 / 7 / 30 / all-time columns compare episodes at the same age once OP3 data exists.
        </p>
      </section>

      <section className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-[14px] border border-border bg-card p-5">
        <Form method="post" className="flex items-center gap-2 text-[13px]">
          <input type="hidden" name="intent" value="toggle-public-overview" />
          <input type="hidden" name="value" value={(!ctx.showOnPublicPage).toString()} />
          <Button type="submit" variant="outline" size="sm" disabled={submitting} role="switch" aria-checked={ctx.showOnPublicPage}>
            {ctx.showOnPublicPage ? "On" : "Off"}
          </Button>
          <span>Show overview on public page</span>
          <span className="text-[11.5px] text-muted-foreground">
            (saved; the public show page isn't built yet to use it)
          </span>
        </Form>
        <div className="text-right text-[12px] text-muted-foreground">
          <div>OP3: Not connected</div>
          <div>Podcast Index: Not connected</div>
        </div>
      </section>
    </div>
  );
}
