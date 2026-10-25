import { Link, data, redirect } from "react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGlobe } from "@fortawesome/free-solid-svg-icons/faGlobe";
import { faPause } from "@fortawesome/free-solid-svg-icons/faPause";
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
import { getPublicPerson } from "~/lib/public.server";
import { formatClock, formatDate, initials } from "~/components/public/public-layout";
import { usePlayer } from "~/components/public/player-context";
import { RichNotes } from "~/components/public/rich-notes";
import { episodeTrack } from "~/components/public/track";
import { thumbUrl } from "~/lib/image-urls";
import { jsonLdMeta, pageMeta, personJsonLd } from "~/lib/seo";

// Public profile for a host or guest at `/{show}/people/{id}/{slug}`. The id is
// authoritative (a wrong slug 301s to the canonical URL). Only people who may
// appear publicly resolve: hosts, and guests credited on a public published
// episode — anyone else is a plain 404, indistinguishable from a bad id.
export async function loader({ params, request }: { params: { showSlug?: string; personId?: string; slug?: string }; request: Request }) {
  const r = getPublicPerson(params.showSlug ?? "", params.personId ?? "");
  if (!r) throw data("Not found", { status: 404 });
  if (params.slug !== r.person.slug) throw redirect(`/${r.show.slug}/people/${r.person.id}/${r.person.slug}`, 301);
  return { ...r, origin: new URL(request.url).origin };
}

export function meta({ loaderData: d }: { loaderData?: Awaited<ReturnType<typeof loader>> }) {
  if (!d) return [{ title: "Not found" }];
  const url = `${d.origin}/${d.show.slug}/people/${d.person.id}/${d.person.slug}`;
  const image = d.person.avatarUrl ? `${d.origin}${d.person.avatarUrl}` : d.show.artworkUrl ? `${d.origin}${d.show.artworkUrl}` : null;
  const description = d.person.bio ?? `${d.person.name} on ${d.show.title}.`;
  return [
    ...pageMeta({ title: `${d.person.name} — ${d.show.title}`, description, url, siteName: d.show.title, type: "profile", image }),
    jsonLdMeta(
      personJsonLd({
        name: d.person.name,
        url,
        description: d.person.bio,
        imageUrl: d.person.avatarUrl ? `${d.origin}${d.person.avatarUrl}` : null,
        jobTitle: d.person.role === "host" ? "Podcast host" : d.person.role === "guest" ? "Podcast guest" : null,
        sameAs: d.person.website ? [d.person.website] : [],
      }),
    ),
  ];
}

export default function PublicPerson({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { show, person, episodes } = loaderData;
  const player = usePlayer();
  const queue = episodes.map((e) => episodeTrack(show, e)).filter((t): t is NonNullable<typeof t> => !!t);
  const href = (e: { publicId: string; slug: string }) => `/${show.slug}/episodes/${e.publicId}/${e.slug}`;

  return (
    <main className="pub-wrap">
      <nav aria-label="Breadcrumb" className="pub-crumb" style={{ marginTop: 32 }}>
        <Link to={`/${show.slug}`}>{show.title}</Link> <span aria-hidden>›</span> <Link to={`/${show.slug}#hosts`}>People</Link>
      </nav>
      <section className="pub-person-hero" style={{ paddingTop: 12 }}>
        {person.avatarUrl ? (
          <img className="pic" src={thumbUrl(person.avatarUrl)!} alt={person.name} width={168} height={168} data-testid="person-photo" />
        ) : (
          <span className="pic" aria-hidden>
            {initials(person.name)}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="pub-eyebrow">{person.role === "host" ? "Host" : person.role === "guest" ? "Guest" : "Contributor"}</div>
          <h1 style={{ marginTop: 8 }}>{person.name}</h1>
          {person.bioHtml && <div style={{ marginTop: 14 }}><RichNotes html={person.bioHtml} /></div>}
          {person.website && (
            <a className="pub-pill" href={person.website} rel="me noopener" target="_blank">
              <FontAwesomeIcon icon={faGlobe} />
              Website
            </a>
          )}
        </div>
      </section>

      <section className="pub-section">
        <div className="pub-section-head">
          <h2>Episodes</h2>
          <span className="pub-muted" style={{ fontSize: 14 }}>
            {episodes.length} with {person.name}
          </span>
        </div>
        {episodes.length === 0 ? (
          <p className="pub-muted">No public episodes yet.</p>
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
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
