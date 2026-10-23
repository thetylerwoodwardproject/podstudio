import { and, desc, eq } from "drizzle-orm";
import { db, shows, episodes } from "@podstudio/db";

// Server-only — see CHANGELOG, "Real bug: two sidebar links silently failed
// to navigate." Download numbers don't exist (no OP3 integration, no
// `analytics_daily` table — Stage 11), so the only real data here is the
// episode list for the comparison table and the one setting this screen owns:
// whether the stats band shows on the public show page (25). It lives under
// `shows.settings.analytics`, next to `settings.embed`.
export function getAnalyticsContext() {
  const show = db.select({ id: shows.id, settings: shows.settings }).from(shows).get();
  if (!show) return null;

  const published = db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      publishAt: episodes.publishAt,
    })
    .from(episodes)
    .where(and(eq(episodes.showId, show.id), eq(episodes.status, "published")))
    .orderBy(desc(episodes.number))
    .all();

  const settings = (show.settings && typeof show.settings === "object" ? show.settings : {}) as Record<
    string,
    unknown
  >;
  const analytics = (settings.analytics && typeof settings.analytics === "object"
    ? settings.analytics
    : {}) as Record<string, unknown>;

  return { published, showOnPublicPage: analytics.showOnPublicPage === true };
}

export function setShowOnPublicPage(value: boolean) {
  const show = db.select({ id: shows.id, settings: shows.settings }).from(shows).get();
  if (!show) return;
  const settings = (show.settings && typeof show.settings === "object" ? show.settings : {}) as Record<
    string,
    unknown
  >;
  const analytics = (settings.analytics && typeof settings.analytics === "object"
    ? settings.analytics
    : {}) as Record<string, unknown>;
  db.update(shows)
    .set({ settings: { ...settings, analytics: { ...analytics, showOnPublicPage: value } } })
    .where(eq(shows.id, show.id))
    .run();
}
