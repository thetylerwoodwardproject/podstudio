import { useEffect, useRef } from "react";
import { formatClock } from "./public-layout";
import { usePlayer, type Track } from "./player-context";
import { SITE_RATES, useSiteController } from "./site-controller";
import { AudioPlayer as AcPlayer, AudioPlayerPlay, AudioPlayerRate, AudioPlayerSkipBack, AudioPlayerSkipForward } from "~/components/ui/audio-player";
import { PlayerClock, PlayerWaveform, SkipIcon } from "~/components/ui/player-icons";
import { useEpisodeWaveform } from "./use-episode-waveform";
import { playIcon } from "~/components/ui/play-icon";

// The inline player on a page (latest episode, episode page). It is a *view* of the
// site-wide player: pressing play starts this track in the shared audio element
// (so it keeps going when the listener navigates and the sticky bar takes over),
// and while this track is current its controls mirror the real state.
export function AudioPlayer({ track, queue, startAt }: { track: Track; queue?: Track[]; startAt?: number | null }) {
  const p = usePlayer();
  const root = useRef<HTMLDivElement>(null);
  const mine = p.current?.id === track.id;
  const playing = mine && p.playing;
  const total = mine && p.duration > 0 ? p.duration : (track.durationS ?? 0);

  // Tell the sticky bar when this inline player is on screen so it can step aside.
  const { setInlineVisible } = p;
  useEffect(() => {
    const el = root.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setInlineVisible(track.id, !!e?.isIntersecting), { threshold: 0.4 });
    io.observe(el);
    return () => {
      io.disconnect();
      setInlineVisible(track.id, false);
    };
  }, [track.id, setInlineVisible]);

  const controller = useSiteController(track, { queue, startAt });
  // Laid out like a podcast host's episode player (Tyler pointed at Buzzsprout's): a big round play
  // button beside the episode's waveform (audiocn Waveform, mirrored, played part in the accent;
  // click or drag to seek, hover for the time), then skips and speed on the left and
  // "elapsed | length" on the right. No box, no volume slider (devices have volume keys).
  const wave = useEpisodeWaveform(track.src);
  return (
    <div className="pp pub-ac" ref={root}>
      <AcPlayer player={controller} shortcuts className="w-full flex-col items-stretch gap-2" aria-label={`Player: ${track.title}`} data-testid="public-player">
        <div className="flex items-center gap-4">
          <AudioPlayerPlay className="size-16 shrink-0 text-xl sm:size-20 sm:text-2xl" aria-label={playing ? `Pause ${track.title}` : `Play ${track.title}`} data-testid="public-play">{playIcon}</AudioPlayerPlay>
          <PlayerWaveform peaks={wave.peaks} loading={wave.loading} duration={total} variant="mirror" barWidth={2} barGap={1} format={(sec) => formatClock(sec)} className="h-14 min-w-0 flex-1 sm:h-16" />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-0.5">
            <AudioPlayerSkipBack seconds={15} disabled={!mine} aria-label="Back 15 seconds" className="size-9"><SkipIcon dir="back" seconds={15} /></AudioPlayerSkipBack>
            <AudioPlayerSkipForward seconds={30} disabled={!mine} aria-label="Forward 30 seconds" className="size-9"><SkipIcon dir="forward" seconds={30} /></AudioPlayerSkipForward>
            <AudioPlayerRate rates={SITE_RATES} aria-label="Playback speed" className="ml-1 text-[13px]" />
          </div>
          <PlayerClock format={(sec) => formatClock(sec)} testid="public-clock" />
        </div>
      </AcPlayer>
      {mine && p.message && (
        <div className="pp-msg" role="status">
          {p.message}
        </div>
      )}
    </div>
  );
}

/** A lone play/pause for one episode (episode grid tiles, list rows): audiocn's play button on the site-wide player. */
export function SitePlayButton({ track, queue, className, title }: { track: Track; queue?: Track[]; className?: string; title: string }) {
  const p = usePlayer();
  const playing = p.current?.id === track.id && p.playing;
  const controller = useSiteController(track, { queue });
  return (
    <AcPlayer player={controller} shortcuts={false} className="pub-ac contents" aria-label={`Player: ${title}`}>
      <AudioPlayerPlay className={className} aria-label={`${playing ? "Pause" : "Play"} ${title}`}>{playIcon}</AudioPlayerPlay>
    </AcPlayer>
  );
}
