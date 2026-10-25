import { Link, data, redirect } from "react-router";
import { getPublicEpisodePage } from "~/lib/public.server";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarDays } from "@fortawesome/free-solid-svg-icons/faCalendarDays";
import { faClock } from "@fortawesome/free-solid-svg-icons/faClock";
import { faDownload } from "@fortawesome/free-solid-svg-icons/faDownload";
import { faLayerGroup } from "@fortawesome/free-solid-svg-icons/faLayerGroup";
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
import { faRss } from "@fortawesome/free-solid-svg-icons/faRss";
import { formatClock, formatDate, formatDuration, initials } from "~/components/public/public-layout";
import { episodeTrack } from "~/components/public/track";
import { AudioPlayer } from "~/components/public/audio-player";
import { ShareMenu } from "~/components/public/small";
import { ShowNotes } from "~/components/public/show-notes";
import { DIRECTORY_ICONS } from "~/lib/directory-icons";
import type { DirectoryId } from "~/lib/directories";
import { pageMeta, jsonLdMeta, episodeJsonLd } from "~/lib/seo";

// Screen 30 (Public episode page) at `/{show}/episodes/{public-id}/{slug}`,
// also what screen 26 (phone) stacks — the layout collapses to a single column
// with 44px targets, so the phone view is the same markup. Per README the
// immutable public id is authoritative: a wrong/missing slug 301s to the canonical
// URL; identity is never derived from the episode number. Show notes are rendered
// as plain text paragraphs — no HTML is accepted, so there is nothing to sanitize.
// `?t=<seconds>` starts playback there (share-at-time). Not built (nothing real to
// back it, none faked): chapters, transcript, soundbites, mentioned links.
// Only public + published episodes resolve — see public.server.ts.
export async function loader({ params, request }: { params: { showSlug?: string; publicId?: string; slug?: string }; request: Request }) {
  const result = getPublicEpisodePage(params.showSlug ?? "", params.publicId ?? "");
  if (!result) throw data("Not found", { status: 404 });
  if (params.slug !== result.episode.slug) {
    throw redirect(`/${result.show.slug}/episodes/${result.episode.publicId}/${result.episode.slug}`, 301);
  }
  const t = Number(new URL(request.url).searchParams.get("t"));
  const startAt = Number.isFinite(t) && t >= 1 && t < 86400 ? Math.floor(t) : null;
  return { ...result, origin: new URL(request.url).origin, startAt };
}

export function meta({ loaderData: d }: { loaderData?: Awaited<ReturnType<typeof loader>> }) {
  if (!d) return [{ title: "Not found" }];
  const base = `${d.origin}/${d.show.slug}`;
  const url = `${base}/episodes/${d.episode.publicId}/${d.episode.slug}`;
  const title = `${d.episode.title} — ${d.show.title}`;
  const image = d.show.artworkUrl ? `${d.origin}${d.show.artworkUrl}` : null;
  const description = d.episode.description ?? d.show.description ?? d.show.title;
  return [
    ...pageMeta({ title, description, url, siteName: d.show.title, type: "article", image, published: d.episode.date }),
    jsonLdMeta(
      episodeJsonLd({
        name: d.episode.title,
        url,
        showName: d.show.title,
        showUrl: base,
        description: d.episode.description,
        datePublished: d.episode.date,
        durationS: d.episode.durationS,
        episodeNumber: d.episode.number,
        seasonNumber: d.episode.season,
        imageUrl: image,
        audioUrl: d.audio ? `${d.origin}${d.audio.src}` : null,
        audioBytes: d.audio?.bytes,
        people: d.credits.map((c) => ({ name: c.name, role: c.role, url: `${base}/people/${c.id}/${c.slug}` })),
      }),
    ),
    {
      tagName: "link",
      rel: "alternate",
      type: "application/json+oembed",
      href: `${d.origin}/oembed?url=${encodeURIComponent(url)}`,
      title,
    },
  ];
}

export default function PublicEpisode({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { show, episode, credits, upNext, audio, newer, startAt } = loaderData;
  const track = audio ? episodeTrack(show, { ...episode, audioSrc: audio.src }) : null;
  const queue = [track, ...upNext.map((e) => episodeTrack(show, e))].filter((t): t is NonNullable<typeof t> => !!t);
  const guests = credits.filter((c) => c.role === "guest").map((c) => c.name);
  const season = episode.season != null && episode.number != null ? `S${episode.season} · Ep. ${episode.number}` : episode.number != null ? `Ep. ${episode.number}` : null;
  const next = (e: { publicId: string; slug: string }) => `/${show.slug}/episodes/${e.publicId}/${e.slug}`;

  return (
    <>
      <main className="pub-wrap" style={{ paddingTop: 40 }}>
        <nav aria-label="Breadcrumb" className="pub-crumb">
          <Link to={`/${show.slug}`}>{show.title}</Link> <span aria-hidden>›</span>{" "}
          <Link to={`/${show.slug}#episodes`}>Episodes</Link> {season && <><span aria-hidden>›</span> <span style={{ color: "var(--pub-fg)" }}>{season.split(" · ").pop()}</span></>}
        </nav>
        <h1>{episode.title}</h1>
        {episode.subtitle && <p className="pub-lead" style={{ marginTop: 12 }}>{episode.subtitle}</p>}
        <div className="pub-meta" data-testid="meta">
          <span>
            <FontAwesomeIcon icon={faCalendarDays} />
            {formatDate(episode.date)}
          </span>
          {episode.durationS ? (
            <span>
              <FontAwesomeIcon icon={faClock} />
              {formatDuration(episode.durationS)}
            </span>
          ) : null}
          {season && (
            <span>
              <FontAwesomeIcon icon={faLayerGroup} />
              {season}
            </span>
          )}
          {guests.length > 0 && <span>with {guests.join(", ")}</span>}
        </div>

        <div className="pub-ep-grid">
          <div style={{ minWidth: 0 }}>
            <div className="pub-card">
              <div className="pub-latest" style={{ gridTemplateColumns: "88px minmax(0,1fr)" }}>
                {show.artworkUrl ? <img className="pub-art" src={show.artworkUrl} alt="" width={88} height={88} /> : <div className="pub-art" aria-hidden />}
                <div style={{ minWidth: 0 }}>
                  <div className="pub-eyebrow">{show.title}</div>
                  <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.015em", lineHeight: 1.25, marginTop: 4 }}>{episode.title}</div>
                </div>
              </div>
              {audio ? (
                <>
                  {track && <AudioPlayer track={track} queue={queue} startAt={startAt} />}
                  <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <a href={audio.src} download className="pub-pill">
                      <FontAwesomeIcon icon={faDownload} />
                      Download MP3
                    </a>
                    <a href={`/${show.slug}/feed`} className="pub-pill">
                      <FontAwesomeIcon icon={faRss} />
                      Subscribe by RSS
                    </a>
                    <ShareMenu
                      path={`/${show.slug}/episodes/${episode.publicId}/${episode.slug}`}
                      title={`${episode.title} — ${show.title}`}
                      embedPath={`/${show.slug}/embed/${episode.publicId}`}
                      trackId={episode.publicId}
                    />
                  </div>
                  {show.directories.length > 0 && (
                    <div className="pub-dirs" style={{ marginTop: 14 }} aria-label="Listen in your app">
                      {show.directories.map((d) => (
                        <a key={d.id} className="pub-pill" href={d.url} target="_blank" rel="noopener">
                          <FontAwesomeIcon icon={DIRECTORY_ICONS[d.id as DirectoryId]} />
                          {d.label}
                        </a>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="pub-muted" style={{ margin: "16px 0 0" }}>
                  Audio isn't available on this page yet.
                </p>
              )}
            </div>

            {episode.description && (
              <section className="pub-section" style={{ marginTop: 40 }} aria-labelledby="notes">
                <h2 id="notes">About this episode</h2>
                <ShowNotes text={episode.description} track={track} queue={queue} />
              </section>
            )}

            {credits.length > 0 && (
              <section className="pub-section" style={{ marginTop: 40 }}>
                <h2>People</h2>
                <div className="pub-people">
                  {credits.map((c) => (
                    <Link key={`${c.id}-${c.role}`} to={`/${show.slug}/people/${c.id}/${c.slug}`} className="pub-card pub-person" style={{ textDecoration: "none", color: "inherit" }}>
                      {c.avatarUrl ? (
                        <img className="pub-avatar" src={c.avatarUrl} alt="" width={40} height={40} style={{ objectFit: "cover" }} />
                      ) : (
                        <span className="pub-avatar" aria-hidden>
                          {initials(c.name)}
                        </span>
                      )}
                      <span>
                        <b>{c.name}</b>
                        <small>{c.role ?? "Credit"}</small>
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
            {(newer || upNext[0]) && (
              <nav className="pub-pn" aria-label="Neighbouring episodes">
                {newer ? (
                  <Link to={next(newer)}>
                    <small>← Newer episode</small>
                    <b>{newer.title}</b>
                  </Link>
                ) : (
                  <span />
                )}
                {upNext[0] ? (
                  <Link to={next(upNext[0])} className="r">
                    <small>Older episode →</small>
                    <b>{upNext[0].title}</b>
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </div>

          <aside className="pub-side" aria-label="More">
            {show.fundingUrl && (
              <div className="pub-tint">
                <b>Support the show</b>
                <p style={{ margin: "6px 0 12px", fontSize: 14 }}>Listener support keeps it going.</p>
                <a className="pub-btn" href={show.fundingUrl} rel="noopener">
                  Support
                </a>
              </div>
            )}
            {upNext.length > 0 && (
              <section>
                <div className="pub-eyebrow" style={{ marginBottom: 8 }}>
                  Up next
                </div>
                {upNext.map((e) => (
                  <Link key={e.publicId} to={next(e)} className="pub-next">
                    {show.artworkUrl ? <img src={show.artworkUrl} alt="" width={48} height={48} /> : <i aria-hidden />}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="pub-muted pub-mono" style={{ fontSize: 11.5 }}>
                        {[e.number != null ? `Ep. ${e.number}` : null, formatClock(e.durationS)].filter(Boolean).join(" · ")}
                      </span>
                      <b>{e.title}</b>
                    </span>
                    <FontAwesomeIcon icon={faPlay} className="pub-muted" style={{ width: 11 }} />
                  </Link>
                ))}
              </section>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}
