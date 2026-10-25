import { Link, data } from "react-router";
import { getPublicShowPage } from "~/lib/public.server";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPause } from "@fortawesome/free-solid-svg-icons/faPause";
import { faArrowRight } from "@fortawesome/free-solid-svg-icons/faArrowRight";
import { faGlobe } from "@fortawesome/free-solid-svg-icons/faGlobe";
import { faHeart } from "@fortawesome/free-solid-svg-icons/faHeart";
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
import { faRss } from "@fortawesome/free-solid-svg-icons/faRss";
import {
  SocialLinks,
  formatClock,
  formatDate,
  formatDuration,
  initials,
} from "~/components/public/public-layout";
import { AudioPlayer } from "~/components/public/audio-player";
import { usePlayer } from "~/components/public/player-context";
import { episodeTrack } from "~/components/public/track";
import { CopyRss, ShowMore } from "~/components/public/small";
import { DIRECTORY_ICONS } from "~/lib/directory-icons";
import type { DirectoryId } from "~/lib/directories";
import { faMagnifyingGlass } from "@fortawesome/free-solid-svg-icons/faMagnifyingGlass";

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
  const sp = new URL(request.url).searchParams;
  const page = Number(sp.get("page") ?? "1") || 1;
  const result = getPublicShowPage(params.showSlug ?? "", page, 10, sp.get("q") ?? "");
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
  const { show, links, hosts, recommended, latest, episodes, total, allTotal, q, sinceYear, page, pageCount } = loaderData;
  const player = usePlayer();
  const href = (e: { publicId: string; slug: string }) => `/${show.slug}/episodes/${e.publicId}/${e.slug}`;
  const eyebrow = [
    sinceYear ? `Podcasting since ${sinceYear}` : null,
    show.updateFrequency,
    show.category,
    `${allTotal} episode${allTotal === 1 ? "" : "s"}`,
  ].filter(Boolean);
  const queue = episodes.map((e) => episodeTrack(show, e)).filter((t): t is NonNullable<typeof t> => !!t);
  const pageHref = (n: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), page: String(n) })}#episodes`;
  const latestTrack = latest ? episodeTrack(show, latest) : null;

  return (
    <main className="pub-wrap">
      <section id="about" className="pub-hero">
        {show.artworkUrl ? (
          <img src={show.artworkUrl} alt={`${show.title} artwork`} width={240} height={240} data-testid="show-artwork" className="pub-art" />
        ) : (
          <div className="pub-art" aria-hidden />
        )}
        <div>
          <div className="pub-eyebrow" data-testid="meta">
            {eyebrow.join(" · ")}
          </div>
          <h1 style={{ marginTop: 10 }}>{show.title}</h1>
          {show.description && <ShowMore text={show.description} />}
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
          <div id="follow" className="pub-follow" data-testid="follow">
            {show.directories.map((d) => (
              <a key={d.id} className="pub-pill" href={d.url} target="_blank" rel="noopener">
                <FontAwesomeIcon icon={DIRECTORY_ICONS[d.id as DirectoryId]} />
                {d.label}
              </a>
            ))}
            <a className="pub-pill pub-pill-accent" href={`/${show.slug}/feed`}>
              <FontAwesomeIcon icon={faRss} />
              RSS
            </a>
            <CopyRss url={`/${show.slug}/feed`} />
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

      {latest && !q && page === 1 && (
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
            {latestTrack ? (
              <AudioPlayer track={latestTrack} queue={queue.length ? queue : undefined} />
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
          <span className="pub-muted" style={{ fontSize: 14 }} data-testid="count">
            {q ? `${total} result${total === 1 ? "" : "s"} for “${q}”` : `${allTotal} total`}
          </span>
          {q && (
            <Link to={`/${show.slug}#episodes`} className="pub-more" style={{ marginTop: 0 }}>
              Clear search
            </Link>
          )}
        </div>
        {(allTotal > 5 || q) && (
          <form method="get" action={`/${show.slug}#episodes`} className="pub-search" role="search">
            <input type="search" name="q" defaultValue={q} placeholder="Search episodes" aria-label="Search episodes" maxLength={100} />
            <button type="submit" className="pub-btn pub-btn-ghost" aria-label="Search">
              <FontAwesomeIcon icon={faMagnifyingGlass} />
            </button>
          </form>
        )}
        {episodes.length === 0 ? (
          <p className="pub-muted">{q ? "No episodes match that search." : "No episodes yet."}</p>
        ) : (
          <div className="pub-list">
            {episodes.map((e) => {
              const t = episodeTrack(show, e);
              const mine = !!t && player.current?.id === t.id;
              const playing = mine && player.playing;
              return (
                <article key={e.publicId} className="pub-ep" aria-current={mine}>
                  <button
                    type="button"
                    className="go"
                    disabled={!t}
                    onClick={() => t && player.play(t, { queue })}
                    aria-label={t ? `${playing ? "Pause" : "Play"} ${e.title}` : `${e.title} (audio not available)`}
                  >
                    <FontAwesomeIcon icon={playing ? faPause : faPlay} style={playing ? undefined : { marginLeft: 2 }} />
                  </button>
                  <div style={{ minWidth: 0 }}>
                    <Link to={href(e)} className="ti">
                      {e.title}
                    </Link>
                    {e.description && <p className="sn">{e.description}</p>}
                    <div className="mt pub-mono">
                      <span>{formatDate(e.date)}</span>
                      {e.number != null && <span>Ep. {e.number}</span>}
                      {e.durationS ? <span>{formatClock(e.durationS)}</span> : null}
                      <span className="g">{e.guests.length ? `with ${e.guests.join(", ")}` : "Solo"}</span>
                      {e.hasVideo ? <span className="pub-badge">Video</span> : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {pageCount > 1 && (
          <nav aria-label="Pagination" className="pub-pager">
            {page > 1 && (
              <Link className="pub-btn pub-btn-ghost" to={pageHref(page - 1)}>
                Newer
              </Link>
            )}
            <span className="pub-muted" style={{ fontSize: 13 }}>
              Page {page} of {pageCount}
            </span>
            {page < pageCount && (
              <Link className="pub-btn pub-btn-ghost" to={pageHref(page + 1)}>
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
  );
}
