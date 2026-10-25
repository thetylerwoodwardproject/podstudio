import { Link } from "react-router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPause } from "@fortawesome/free-solid-svg-icons/faPause";
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { formatClock } from "./public-layout";
import { usePlayer } from "./player-context";

// The bar pinned to the bottom of every public page once something is playing.
// It steps aside while the current track's own inline player is on screen.
export function StickyPlayer() {
  const p = usePlayer();
  const t = p.current;
  if (!t) return null;
  const total = p.duration > 0 ? p.duration : (t.durationS ?? 0);
  const pct = total ? Math.min(100, (p.time / total) * 100) : 0;
  return (
    <div className="pub-sticky" data-hidden={p.inlineVisible} role="region" aria-label="Now playing" data-testid="sticky-player">
      <div className="pub-sticky-in">
        {t.artwork ? <img src={t.artwork} alt="" width={44} height={44} /> : <i aria-hidden />}
        <div className="meta">
          <Link to={t.href}>{t.title}</Link>
          <small>{[t.show, t.number != null ? `Ep. ${t.number}` : null].filter(Boolean).join(" · ")}</small>
        </div>
        <button type="button" className="pp-btn" aria-label="Back 15 seconds" onClick={() => p.skip(-15)}>
          −15
        </button>
        <button
          type="button"
          className="pp-play small"
          onClick={p.toggle}
          aria-label={p.playing ? `Pause ${t.title}` : `Play ${t.title}`}
        >
          <FontAwesomeIcon icon={p.playing ? faPause : faPlay} style={p.playing ? undefined : { marginLeft: 2 }} />
        </button>
        <button type="button" className="pp-btn" aria-label="Forward 30 seconds" onClick={() => p.skip(30)}>
          +30
        </button>
        <div className="scrub">
          <input
            className="pp-range"
            type="range"
            min={0}
            max={1000}
            step={1}
            value={total ? Math.round((p.time / total) * 1000) : 0}
            style={{ ["--p" as string]: `${pct}%` }}
            aria-label="Seek"
            aria-valuetext={`${formatClock(p.time)} of ${formatClock(total)}`}
            onChange={(e) => total && p.seekTo((Number(e.target.value) / 1000) * total)}
          />
        </div>
        <span className="pp-time pub-mono tm">
          {formatClock(p.time)} / {formatClock(total)}
        </span>
        <button type="button" className="pp-btn" aria-label="Playback speed" onClick={p.cycleRate}>
          {p.rate}×
        </button>
        <button type="button" className="pp-btn x" aria-label="Close player" onClick={p.close}>
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
