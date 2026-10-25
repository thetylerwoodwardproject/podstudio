import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPause } from "@fortawesome/free-solid-svg-icons/faPause";
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
import { formatClock } from "./public-layout";

// Listener-facing audio player for the public pages (styles: publicCss, `.pp-*`).
// Same behaviour as the embeddable player: nothing loads until play is pressed
// (preload="none"), −15 / +30, scrubber, speed, Media Session for lock-screen
// controls. Real <audio>, so it also works with keyboard and screen readers.
const RATES = [1, 1.25, 1.5, 2];

export function AudioPlayer({
  src,
  title,
  show,
  artwork,
  durationS,
}: {
  src: string;
  title: string;
  show: string;
  artwork?: string | null;
  durationS: number | null;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(durationS ?? 0);
  const [rate, setRate] = useState(0);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const a = audio.current;
    if (!a || !("mediaSession" in navigator)) return;
    const onPlay = () => {
      if (window.MediaMetadata) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title,
          artist: show,
          album: show,
          artwork: artwork ? [{ src: new URL(artwork, location.href).href }] : [],
        });
      }
    };
    a.addEventListener("play", onPlay);
    const set = (n: MediaSessionAction, fn: MediaSessionActionHandler) => {
      try {
        navigator.mediaSession.setActionHandler(n, fn);
      } catch {
        /* unsupported action */
      }
    };
    set("seekbackward", () => a.currentTime = Math.max(0, a.currentTime - 15));
    set("seekforward", () => a.currentTime += 30);
    return () => a.removeEventListener("play", onPlay);
  }, [title, show, artwork]);

  const total = Number.isFinite(dur) && dur > 0 ? dur : 0;
  const pct = total ? Math.min(100, (time / total) * 100) : 0;

  function toggle() {
    const a = audio.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => setMsg("Couldn't start playback."));
    else a.pause();
  }

  return (
    <div className="pp">
      <audio
        ref={audio}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDur(e.currentTarget.duration)}
        onWaiting={() => setMsg("Loading…")}
        onPlaying={() => setMsg("")}
        onError={() => setMsg("Couldn't load the audio.")}
      />
      <div className="pp-row">
        <button type="button" className="pp-play" onClick={toggle} aria-label={playing ? `Pause ${title}` : `Play ${title}`}>
          <FontAwesomeIcon icon={playing ? faPause : faPlay} style={playing ? undefined : { marginLeft: 2 }} />
        </button>
        <button type="button" className="pp-btn" aria-label="Back 15 seconds" onClick={() => audio.current && (audio.current.currentTime = Math.max(0, audio.current.currentTime - 15))}>
          −15
        </button>
        <button type="button" className="pp-btn" aria-label="Forward 30 seconds" onClick={() => audio.current && (audio.current.currentTime += 30)}>
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
              const a = audio.current;
              if (a && total) a.currentTime = (Number(e.target.value) / 1000) * total;
            }}
          />
        </div>
        <span className="pp-time pub-mono">
          {formatClock(time)} / {formatClock(total)}
        </span>
        <button
          type="button"
          className="pp-btn"
          aria-label="Playback speed"
          onClick={() => {
            const next = (rate + 1) % RATES.length;
            setRate(next);
            if (audio.current) audio.current.playbackRate = RATES[next]!;
          }}
        >
          {RATES[rate]}×
        </button>
      </div>
      {msg && (
        <div className="pp-msg" role="status">
          {msg}
        </div>
      )}
    </div>
  );
}
