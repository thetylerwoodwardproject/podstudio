import { useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPause } from "@fortawesome/free-solid-svg-icons/faPause";
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
import { formatClock } from "./public-layout";
import { usePlayer, type Track } from "./player-context";

// The inline player on a page (latest episode, episode page). It is a *view* of the
// site-wide player: pressing play starts this track in the shared audio element
// (so it keeps going when the listener navigates and the sticky bar takes over),
// and while this track is current its controls mirror the real state.
export function AudioPlayer({ track, queue }: { track: Track; queue?: Track[] }) {
  const p = usePlayer();
  const root = useRef<HTMLDivElement>(null);
  const mine = p.current?.id === track.id;
  const playing = mine && p.playing;
  const total = mine && p.duration > 0 ? p.duration : (track.durationS ?? 0);
  const time = mine ? p.time : 0;
  const pct = total ? Math.min(100, (time / total) * 100) : 0;

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

  return (
    <div className="pp" ref={root}>
      <div className="pp-row">
        <button
          type="button"
          className="pp-play"
          onClick={() => p.play(track, { queue })}
          aria-label={playing ? `Pause ${track.title}` : `Play ${track.title}`}
        >
          <FontAwesomeIcon icon={playing ? faPause : faPlay} style={playing ? undefined : { marginLeft: 2 }} />
        </button>
        <button type="button" className="pp-btn" aria-label="Back 15 seconds" disabled={!mine} onClick={() => p.skip(-15)}>
          −15
        </button>
        <button type="button" className="pp-btn" aria-label="Forward 30 seconds" disabled={!mine} onClick={() => p.skip(30)}>
          +30
        </button>
        <div className="pp-scrub">
          <input
            className="pp-range"
            type="range"
            min={0}
            max={1000}
            step={1}
            value={total ? Math.round((time / total) * 1000) : 0}
            style={{ ["--p" as string]: `${pct}%` }}
            aria-label="Seek"
            aria-valuetext={`${formatClock(time)} of ${formatClock(total)}`}
            onChange={(e) => {
              if (!total) return;
              const at = (Number(e.target.value) / 1000) * total;
              if (mine) p.seekTo(at);
              else p.play(track, { queue, at });
            }}
          />
        </div>
        <span className="pp-time pub-mono">
          {formatClock(time)} / {formatClock(total)}
        </span>
        <button type="button" className="pp-btn" aria-label="Playback speed" onClick={p.cycleRate}>
          {p.rate}×
        </button>
      </div>
      {mine && p.message && (
        <div className="pp-msg" role="status">
          {p.message}
        </div>
      )}
    </div>
  );
}
