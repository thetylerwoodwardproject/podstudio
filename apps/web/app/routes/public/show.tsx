import { Link, data } from "react-router";
import { getPublicShowPage } from "~/lib/public.server";
import { PublicLayout, SocialLinks, formatDate, formatDuration } from "~/components/public/public-layout";

// Screen 25 (Public show page) at `/{show-slug}`. Per README: header, hero
// (title, cadence, description, hosts, follow links), latest episode, support
// card, paginated public episodes list; server-rendered with Open Graph.
// Built from real data: shows/people/show_links/episodes + Brand & theme.
// The RSS button links to the real `/{show}/feed` (channel metadata only — it
// has no items until audio exists).
// Artwork is the verified show artwork (Show tags screen), when one is set.
// Not built (needs things that don't exist yet, none faked): category
// display, Apple/Spotify/etc. follow buttons
// (only the 12 social platforms from screen 29 exist as links), playable
// audio/video + chapters + transcript (no media or transcripts yet),
// transcript search, oEmbed discovery (no /oembed).
// Episode "Play" therefore links to the episode page rather than playing.
// Only public + published episodes are queried — see public.server.ts.
export async function loader({ params, request }: { params: { showSlug?: string }; request: Request }) {
  const page = Number(new URL(request.url).searchParams.get("page") ?? "1") || 1;
  const result = getPublicShowPage(params.showSlug ?? "", page);
  if (!result) throw data("Not found", { status: 404 });
  return { ...result, origin: new URL(request.url).origin };
}

export function meta({ loaderData: d }: { loaderData?: Awaited<ReturnType<typeof loader>> }) {
  if (!d) return [{ title: "Not found" }];
  const description = d.show.description ?? `Episodes of ${d.show.title}`;
  return [
    { title: d.show.title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: d.show.title },
    { property: "og:description", content: description },
    ...(d.show.artworkUrl ? [{ property: "og:image", content: `${d.origin}${d.show.artworkUrl}` }] : []),
    {
      tagName: "link",
      rel: "alternate",
      type: "application/json+oembed",
      href: `${d.origin}/oembed?url=${encodeURIComponent(`${d.origin}/${d.show.slug}`)}`,
      title: d.show.title,
    },
  ];
}

export default function PublicShow({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { show, links, hosts, recommended, latest, episodes, total, page, pageCount } = loaderData;
  const href = (e: { publicId: string; slug: string }) => `/${show.slug}/episodes/${e.publicId}/${e.slug}`;

  return (
    <PublicLayout show={show} links={links}>
      <main className="pub-wrap" style={{ paddingTop: 40 }}>
        <section id="about" style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
          {show.artworkUrl && (
            <img
              src={show.artworkUrl}
              alt={`${show.title} artwork`}
              width={168}
              height={168}
              data-testid="show-artwork"
              style={{ width: 168, height: 168, objectFit: "cover", borderRadius: "var(--brand-radius-card)", flex: "none" }}
            />
          )}
          <div style={{ flex: 1, minWidth: 260 }}>
          <h1>{show.title}</h1>
          <p className="pub-muted" style={{ margin: "8px 0 0" }} data-testid="meta">
            {[show.updateFrequency && `Updates ${show.updateFrequency}`, `${total} episode${total === 1 ? "" : "s"}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {show.description && <p style={{ fontSize: 17, maxWidth: 640 }}>{show.description}</p>}
          {hosts.length > 0 && (
            <p className="pub-muted" style={{ fontSize: 14 }}>
              Hosted by {hosts.map((h) => h.name).join(", ")}
            </p>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <a className="pub-btn" href={`/${show.slug}/feed`}>
              RSS
            </a>
            {show.website && (
              <a className="pub-btn pub-btn-ghost" href={show.website} rel="noopener">
                Website
              </a>
            )}
            <SocialLinks links={links} />
          </div>
          </div>
        </section>

        {latest && (
          <section style={{ marginTop: 40 }} aria-labelledby="latest">
            <h2 id="latest">Latest episode</h2>
            <div className="pub-tint">
              <div className="pub-muted" style={{ fontSize: 13 }}>
                {formatDate(latest.date)}
                {latest.durationS ? ` · ${formatDuration(latest.durationS)}` : ""}
              </div>
              <h3 style={{ margin: "4px 0 8px", fontSize: 22 }}>
                <Link to={href(latest)} style={{ color: "inherit" }}>
                  {latest.title}
                </Link>
              </h3>
              {latest.description && <p style={{ margin: "0 0 12px" }}>{latest.description}</p>}
              <Link className="pub-btn" to={href(latest)}>
                Open episode
              </Link>
            </div>
          </section>
        )}

        {show.fundingUrl && (
          <section id="support" style={{ marginTop: 40 }}>
            <div className="pub-card">
              <h2>Support the show</h2>
              {show.fundingMessage && <p style={{ margin: "0 0 12px" }}>{show.fundingMessage}</p>}
              <a className="pub-btn" href={show.fundingUrl} rel="noopener">
                Support
              </a>
            </div>
          </section>
        )}

        <section id="episodes" style={{ marginTop: 40 }}>
          <h2>All episodes</h2>
          {episodes.length === 0 ? (
            <p className="pub-muted">No episodes yet.</p>
          ) : (
            <div>
              {episodes.map((e) => (
                <div key={e.publicId} className="pub-row">
                  <span className="pub-muted" style={{ minWidth: 28 }}>
                    {e.number ?? ""}
                  </span>
                  <span style={{ flex: 1 }}>
                    <Link className="t" to={href(e)}>
                      {e.title}
                    </Link>
                    {e.hasVideo ? <span className="pub-badge" style={{ marginLeft: 8 }}>Video</span> : null}
                  </span>
                  <span className="pub-muted" style={{ fontSize: 13 }}>
                    {formatDate(e.date)}
                    {e.durationS ? ` · ${formatDuration(e.durationS)}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
          {pageCount > 1 && (
            <nav aria-label="Pagination" style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
              {page > 1 && (
                <Link className="pub-btn pub-btn-ghost" to={`?page=${page - 1}`}>
                  Newer
                </Link>
              )}
              <span className="pub-muted" style={{ fontSize: 13 }}>
                Page {page} of {pageCount}
              </span>
              {page < pageCount && (
                <Link className="pub-btn pub-btn-ghost" to={`?page=${page + 1}`}>
                  Older
                </Link>
              )}
            </nav>
          )}
        </section>

        {recommended.length > 0 && (
          <section id="recommended" style={{ marginTop: 40 }}>
            <h2>Shows we recommend</h2>
            <div>
              {recommended.map((r) => (
                <div key={r.title} className="pub-row">
                  <span style={{ flex: 1 }}>
                    {r.feedUrl ? (
                      <a className="t" href={r.feedUrl} rel="noopener" style={{ fontWeight: 500 }}>
                        {r.title}
                      </a>
                    ) : (
                      <span style={{ fontWeight: 500 }}>{r.title}</span>
                    )}
                    {r.note && <span className="pub-muted" style={{ display: "block", fontSize: 13 }}>{r.note}</span>}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </PublicLayout>
  );
}
