import { Link, data, redirect } from "react-router";
import { getPublicEpisodePage } from "~/lib/public.server";
import { PublicLayout, formatDate, formatDuration } from "~/components/public/public-layout";

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
  const hosts = credits.filter((c) => c.role === "host").map((c) => c.name);
  const meta = [
    formatDate(episode.date),
    formatDuration(episode.durationS),
    episode.season != null && episode.number != null ? `S${episode.season} · Ep. ${episode.number}` : null,
    guests.length ? `with ${guests.join(", ")}` : null,
  ].filter(Boolean);

  return (
    <PublicLayout show={show} links={links}>
      <main className="pub-wrap" style={{ paddingTop: 32 }}>
        <nav aria-label="Breadcrumb" className="pub-muted" style={{ fontSize: 13, marginBottom: 12 }}>
          <Link to={`/${show.slug}`}>{show.title}</Link> / Episodes
        </nav>
        <h1>{episode.title}</h1>
        {episode.subtitle && <p className="pub-muted" style={{ fontSize: 17, margin: "6px 0 0" }}>{episode.subtitle}</p>}
        <p className="pub-muted" style={{ fontSize: 14 }} data-testid="meta">
          {meta.join(" · ")}
        </p>

        {audio ? (
          <div style={{ margin: "20px 0" }}>
            <audio controls preload="none" src={audio.src} style={{ width: "100%" }} aria-label={`Play ${episode.title}`} />
            <a href={audio.src} download className="pub-muted" style={{ fontSize: 13 }}>
              Download MP3
            </a>
          </div>
        ) : (
          <div className="pub-tint" style={{ margin: "20px 0" }}>
            Audio isn't available on this page yet.
          </div>
        )}

        <section>
          <h2>Show notes</h2>
          {episode.description ? (
            episode.description
              .split(/\n{2,}/)
              .map((para, i) => <p key={i} style={{ whiteSpace: "pre-line" }}>{para}</p>)
          ) : (
            <p className="pub-muted">No show notes for this episode.</p>
          )}
        </section>

        {(hosts.length > 0 || guests.length > 0) && (
          <section style={{ marginTop: 24 }}>
            <h2>People</h2>
            <p style={{ margin: 0 }}>
              {hosts.length > 0 && <>Hosts: {hosts.join(", ")}</>}
              {hosts.length > 0 && guests.length > 0 && " · "}
              {guests.length > 0 && <>Guests: {guests.join(", ")}</>}
            </p>
          </section>
        )}

        {upNext && (
          <section style={{ marginTop: 32 }}>
            <h2>Up next</h2>
            <Link className="pub-btn pub-btn-ghost" to={`/${show.slug}/episodes/${upNext.publicId}/${upNext.slug}`}>
              {upNext.number != null ? `Ep. ${upNext.number} — ` : ""}
              {upNext.title}
            </Link>
          </section>
        )}
      </main>
    </PublicLayout>
  );
}
