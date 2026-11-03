import { Link } from "react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { formatClock } from "./public-layout";
import { usePlayer } from "./player-context";
import { SITE_RATES, useSiteController } from "./site-controller";
import { AudioPlayer as AcPlayer, AudioPlayerPlay, AudioPlayerRate, AudioPlayerSkipBack, AudioPlayerSkipForward, AudioPlayerTime } from "~/components/ui/audio-player";
import { PlayerVolume, PlayerWaveform, SkipIcon } from "~/components/ui/player-icons";
import { useEpisodeWaveform } from "./use-episode-waveform";
import { playIcon } from "~/components/ui/play-icon";

// The bar pinned to the bottom of every public page once something is playing.
// It steps aside while the current track's own inline player is on screen.
export function StickyPlayer() {
  const p = usePlayer();
  const t = p.current;
  const controller = useSiteController(null);
  const wave = useEpisodeWaveform(p.current?.src);
  if (!t) return null;
  const total = p.duration > 0 ? p.duration : (t.durationS ?? 0);
  return (
    <div className="pub-sticky" data-hidden={p.inlineVisible} role="region" aria-label="Now playing" data-testid="sticky-player">
      <div className="pub-sticky-in">
        {t.artwork ? <img src={t.artwork} alt="" width={44} height={44} /> : <i aria-hidden />}
        <div className="meta">
          <Link to={t.href}>{t.title}</Link>
          <small>{[t.show, t.number != null ? `Ep. ${t.number}` : null].filter(Boolean).join(" · ")}</small>
        </div>
        {/* compact: play · waveform (audiocn Waveform as the seek bar) · remaining · speed (+ skips and volume when there's room) */}
        <AcPlayer player={controller} className="pub-ac sticky-ac min-w-0 flex-1 flex-nowrap gap-2" aria-label="Now playing controls">
          <AudioPlayerSkipBack seconds={15} className="sticky-extra" aria-label="Back 15 seconds"><SkipIcon dir="back" seconds={15} /></AudioPlayerSkipBack>
          <AudioPlayerPlay aria-label={p.playing ? `Pause ${t.title}` : `Play ${t.title}`}>{playIcon}</AudioPlayerPlay>
          <AudioPlayerSkipForward seconds={30} className="sticky-extra" aria-label="Forward 30 seconds"><SkipIcon dir="forward" seconds={30} /></AudioPlayerSkipForward>
          <PlayerWaveform peaks={wave.peaks} loading={wave.loading} duration={total} barWidth={2} barGap={1} format={(sec) => formatClock(sec)} className="h-9 min-w-20 flex-1" />
          <AudioPlayerTime type="remaining" format={(sec) => `−${formatClock(sec)}`} />
          <AudioPlayerRate rates={SITE_RATES} aria-label="Playback speed" />
          <PlayerVolume className="sticky-extra" slider={false} />
        </AcPlayer>
        <button type="button" className="sticky-close" aria-label="Close player" onClick={p.close}>
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>
      {p.message && (
        <div className="pp-msg" role="status" style={{ padding: "0 20px 8px" }}>
          {p.message}
        </div>
      )}
    </div>
  );
}
