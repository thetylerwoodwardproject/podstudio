import { Link, data, redirect } from "react-router";
import { getPublicEpisodePage } from "~/lib/public.server";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarDays } from "@fortawesome/free-solid-svg-icons/faCalendarDays";
import { faClock } from "@fortawesome/free-solid-svg-icons/faClock";
import { faDownload } from "@fortawesome/free-solid-svg-icons/faDownload";
import { faLayerGroup } from "@fortawesome/free-solid-svg-icons/faLayerGroup";
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
import { faRss } from "@fortawesome/free-solid-svg-icons/faRss";
import { PublicLayout, formatClock, formatDate, formatDuration, initials } from "~/components/public/public-layout";
import { AudioPlayer } from "~/components/public/audio-player";

// Screen 30 (Public episode page) at `/{show}/episodes/{public-id}/{slug}`,
// also what screen 26 (phone) stacks — the layout is a single column with 44px
// targets, so the phone view is the same markup. Per README the immutable
// public id is authoritative: a wrong/missing slug 301s to the canonical URL;
// identity is never derived from the episode number. Show notes are rendered
// as plain text paragraphs — no HTML is accepted, so there is nothing to
// sanitize. Not built (nothing real to back it, none faked): player, chapters,
// transcript + dialog, soundbites, mentioned links, MP3 download, listen-in-app
// buttons / sticky bar, share-at-time, JSON-LD (omitted until audio URL exists).
// Only public + published episodes resolve — see public.server.ts.
export async function loader({ params, request }: { params: { showSlug?: string; publicId?: string; slug?: string }; request: Request }) {
  const result = getPublicEpisodePage(params.showSlug ?? "", params.publicId ?? "");
  if (!result) throw data("Not found", { status: 404 });
  if (params.slug !== result.episode.slug) {
    throw redirect(`/${result.show.slug}/episodes/${result.episode.publicId}/${result.episode.slug}`, 301);
  }
  return { ...result, origin: new URL(request.url).origin };
}

export function meta({ loaderData: d }: { loaderData?: Awaited<ReturnType<typeof loader>> }) {
  if (!d) return [{ title: "Not found" }];
  const title = `${d.episode.title} — ${d.show.title}`;
  const description = d.episode.description ?? d.show.description ?? d.show.title;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "article" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    ...(d.show.artworkUrl ? [{ property: "og:image", content: `${d.origin}${d.show.artworkUrl}` }] : []),
    {
      tagName: "link",
      rel: "alternate",
      type: "application/json+oembed",
      href: `${d.origin}/oembed?url=${encodeURIComponent(`${d.origin}/${d.show.slug}/episodes/${d.episode.publicId}/${d.episode.slug}`)}`,
      title,
    },
  ];
}

export default function PublicEpisode({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { show, links, episode, credits, upNext, audio } = loaderData;
  const guests = credits.filter((c) => c.role === "guest").map((c) => c.name);
  const season = episode.season != null && episode.number != null ? `S${episode.season} · Ep. ${episode.number}` : episode.number != null ? `Ep. ${episode.number}` : null;
  const next = (e: { publicId: string; slug: string }) => `/${show.slug}/episodes/${e.publicId}/${e.slug}`;
  const paragraphs = episode.description ? episode.description.split(/\n{2,}/) : [];

  return (
    <PublicLayout show={show} links={links}>
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
                  <AudioPlayer src={audio.src} title={episode.title} show={show.title} artwork={show.artworkUrl} durationS={episode.durationS} />
                  <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <a href={audio.src} download className="pub-pill">
                      <FontAwesomeIcon icon={faDownload} />
                      Download MP3
                    </a>
                    <a href={`/${show.slug}/feed`} className="pub-pill">
                      <FontAwesomeIcon icon={faRss} />
                      Subscribe by RSS
                    </a>
                  </div>
                </>
              ) : (
                <p className="pub-muted" style={{ margin: "16px 0 0" }}>
                  Audio isn't available on this page yet.
                </p>
              )}
            </div>

            {paragraphs.length > 0 && (
              <section className="pub-section" style={{ marginTop: 40 }}>
                <h2>About this episode</h2>
                <div className="pub-notes">
                  {paragraphs.map((para, i) => (
                    <p key={i} style={{ whiteSpace: "pre-line" }}>
                      {para}
                    </p>
                  ))}
                </div>
              </section>
            )}

            {credits.length > 0 && (
              <section className="pub-section" style={{ marginTop: 40 }}>
                <h2>People</h2>
                <div className="pub-people">
                  {credits.map((c) => (
                    <div key={`${c.name}-${c.role}`} className="pub-card pub-person">
                      <span className="pub-avatar" aria-hidden>
                        {initials(c.name)}
                      </span>
                      <span>
                        <b>{c.name}</b>
                        <small>{c.role ?? "Credit"}</small>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
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
    </PublicLayout>
  );
}
