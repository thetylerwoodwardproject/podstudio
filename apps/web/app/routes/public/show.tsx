import { Link, data } from "react-router";
import { getPublicShowPage } from "~/lib/public.server";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight } from "@fortawesome/free-solid-svg-icons/faArrowRight";
import { faGlobe } from "@fortawesome/free-solid-svg-icons/faGlobe";
import { faHeart } from "@fortawesome/free-solid-svg-icons/faHeart";
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
import { faRss } from "@fortawesome/free-solid-svg-icons/faRss";
import {
  PublicLayout,
  SocialLinks,
  formatClock,
  formatDate,
  formatDuration,
  initials,
} from "~/components/public/public-layout";
import { AudioPlayer } from "~/components/public/audio-player";

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
  const eyebrow = [show.updateFrequency, show.category, `${total} episode${total === 1 ? "" : "s"}`].filter(Boolean);

  return (
    <PublicLayout show={show} links={links}>
      <main className="pub-wrap">
        <section id="about" className="pub-hero">
          {show.artworkUrl ? (
            <img
              src={show.artworkUrl}
              alt={`${show.title} artwork`}
              width={240}
              height={240}
              data-testid="show-artwork"
              className="pub-art"
            />
          ) : (
            <div className="pub-art" aria-hidden />
          )}
          <div>
            <div className="pub-eyebrow" data-testid="meta">
              {eyebrow.join(" · ")}
            </div>
            <h1 style={{ marginTop: 10 }}>{show.title}</h1>
            {show.description && <p className="pub-lead">{show.description}</p>}
            {hosts.length > 0 && (
              <div className="pub-hosts">
                <span className="pub-avatars" aria-hidden>
                  {hosts.slice(0, 4).map((h) => (
                    <span key={h.name} className="pub-avatar">
                      {initials(h.name)}
                    </span>
                  ))}
                </span>
                <span>Hosted by {hosts.map((h) => h.name).join(" & ")}</span>
              </div>
            )}
            <div id="follow" className="pub-follow">
              <a className="pub-pill pub-pill-accent" href={`/${show.slug}/feed`}>
                <FontAwesomeIcon icon={faRss} />
                RSS
              </a>
              {show.website && (
                <a className="pub-pill" href={show.website} rel="noopener">
                  <FontAwesomeIcon icon={faGlobe} />
                  Website
                </a>
              )}
              <SocialLinks links={links} labelled />
            </div>
          </div>
        </section>

        {latest && (
          <section className="pub-section" aria-labelledby="latest">
            <div className="pub-section-head">
              <h2 id="latest">Latest episode</h2>
              <span className="pub-muted" style={{ fontSize: 14 }}>
                {[formatDate(latest.date), formatDuration(latest.durationS), latest.guests.length ? `with ${latest.guests.join(", ")}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            <div className="pub-card">
              <div className="pub-latest">
                {show.artworkUrl ? <img className="pub-art" src={show.artworkUrl} alt="" width={112} height={112} /> : <div className="pub-art" aria-hidden />}
                <div style={{ minWidth: 0 }}>
                  <div className="pub-eyebrow">{latest.number != null ? `Ep. ${latest.number}` : show.title}</div>
                  <h3>
                    <Link to={href(latest)}>{latest.title}</Link>
                  </h3>
                  {latest.description && <p className="pub-clamp">{latest.description}</p>}
                </div>
              </div>
              {latest.audioSrc ? (
                <AudioPlayer src={latest.audioSrc} title={latest.title} show={show.title} artwork={show.artworkUrl} durationS={latest.durationS} />
              ) : (
                <p className="pub-muted" style={{ margin: "16px 0 0", fontSize: 14 }}>
                  Audio isn't available for this episode yet.
                </p>
              )}
              <div style={{ marginTop: 16 }}>
                <Link className="pub-btn pub-btn-ghost" to={href(latest)}>
                  Open episode <FontAwesomeIcon icon={faArrowRight} style={{ width: 12 }} />
                </Link>
              </div>
            </div>
          </section>
        )}

        {show.fundingUrl && (
          <section id="support" className="pub-section">
            <div className="pub-card pub-support">
              <span className="ic">
                <FontAwesomeIcon icon={faHeart} />
              </span>
              <div>
                <h2 style={{ fontSize: 18, marginBottom: 4 }}>Support the show</h2>
                {show.fundingMessage && <p style={{ margin: "0 0 12px" }}>{show.fundingMessage}</p>}
                <a className="pub-btn" href={show.fundingUrl} rel="noopener">
                  Support
                </a>
              </div>
            </div>
          </section>
        )}

        <section id="episodes" className="pub-section">
          <div className="pub-section-head">
            <h2>All episodes</h2>
            <span className="pub-muted" style={{ fontSize: 14 }}>
              {total} total
            </span>
          </div>
          {episodes.length === 0 ? (
            <p className="pub-muted">No episodes yet.</p>
          ) : (
            <div className="pub-list">
              {episodes.map((e) => (
                <Link key={e.publicId} to={href(e)} className="pub-ep" aria-label={`${e.title}${e.audioSrc ? "" : " (audio not available)"}`}>
                  <span className="go" aria-hidden>
                    <FontAwesomeIcon icon={faPlay} style={{ marginLeft: 2 }} />
                  </span>
                  <span className="no pub-mono">{e.number != null ? `Ep. ${e.number}` : ""}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="ti" style={{ display: "block" }}>
                      {e.title}
                      {e.hasVideo ? <span className="pub-badge" style={{ marginLeft: 8, fontWeight: 400 }}>Video</span> : null}
                    </span>
                    <span className="sub" style={{ display: "block" }}>
                      {e.guests.length ? `with ${e.guests.join(", ")}` : "Solo"}
                    </span>
                  </span>
                  <span className="dt">{formatDate(e.date)}</span>
                  <span className="du pub-mono">{formatClock(e.durationS)}</span>
                </Link>
              ))}
            </div>
          )}
          {pageCount > 1 && (
            <nav aria-label="Pagination" className="pub-pager">
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
          <section id="recommended" className="pub-section">
            <div className="pub-section-head">
              <h2>Shows we recommend</h2>
            </div>
            <div className="pub-recs">
              {recommended.map((r) => (
                <div key={r.title} className="pub-card pub-rec">
                  <b>
                    {r.feedUrl ? (
                      <a href={r.feedUrl} rel="noopener">
                        {r.title}
                      </a>
                    ) : (
                      r.title
                    )}
                  </b>
                  {r.note && <span className="pub-muted" style={{ fontSize: 14 }}>{r.note}</span>}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </PublicLayout>
  );
}
