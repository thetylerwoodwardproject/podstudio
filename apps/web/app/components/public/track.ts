import type { Track } from "./player-context";

/** Builds a player Track for an episode row that has verified audio; null otherwise. */
export function episodeTrack(
  show: { slug: string; title: string; artworkUrl?: string | null },
  e: { publicId: string; slug: string; title: string; number: number | null; durationS: number | null; audioSrc: string | null },
): Track | null {
  if (!e.audioSrc) return null;
  return {
    id: e.publicId,
    src: e.audioSrc,
    title: e.title,
    show: show.title,
    artwork: show.artworkUrl ?? null,
    href: `/${show.slug}/episodes/${e.publicId}/${e.slug}`,
    durationS: e.durationS,
    number: e.number,
  };
}
