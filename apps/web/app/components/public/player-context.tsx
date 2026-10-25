import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

// One <audio> element for the whole public site. It lives in the public layout
// route, so playback keeps going as the listener moves between the show page and
// episode pages (client-side navigation), and any play button anywhere drives the
// same sticky bar. Nothing loads until a listener presses play. No cookies, no
// storage, no third parties.
export interface Track {
  id: string;
  src: string;
  title: string;
  show: string;
  artwork?: string | null;
  href: string;
  durationS: number | null;
  number?: number | null;
}

const RATES = [1, 1.25, 1.5, 2];

interface PlayerApi {
  current: Track | null;
  playing: boolean;
  time: number;
  duration: number;
  rate: number;
  message: string;
  /** Start (or toggle, if already current) a track; `queue` is what plays after it, in order. */
  play: (track: Track, opts?: { queue?: Track[]; at?: number }) => void;
  toggle: () => void;
  seekTo: (seconds: number) => void;
  skip: (delta: number) => void;
  cycleRate: () => void;
  close: () => void;
  /** Inline players report visibility so the sticky bar can step aside. */
  setInlineVisible: (id: string, visible: boolean) => void;
  inlineVisible: boolean;
}

const Ctx = createContext<PlayerApi | null>(null);

export function usePlayer() {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlayer must be used inside <PlayerProvider>");
  return v;
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null);
  const queue = useRef<Track[]>([]);
  const pendingAt = useRef<number | null>(null);
  const [current, setCurrent] = useState<Track | null>(null);
  const currentRef = useRef<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(0);
  const rateRef = useRef(0);
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState<Set<string>>(new Set());

  const load = useCallback((track: Track, at: number | null) => {
    const a = audio.current;
    if (!a) return;
    currentRef.current = track;
    setCurrent(track);
    setTime(0);
    setDuration(track.durationS ?? 0);
    setMessage("");
    pendingAt.current = at;
    a.src = track.src;
    a.playbackRate = RATES[rateRef.current]!;
    a.play().catch(() => setMessage("Couldn't start playback."));
  }, []);

  const next = useCallback(() => {
    const cur = currentRef.current;
    if (!cur) return;
    const i = queue.current.findIndex((t) => t.id === cur.id);
    const n = i >= 0 ? queue.current[i + 1] : undefined;
    if (n) load(n, null);
  }, [load]);

  const prev = useCallback(() => {
    const cur = currentRef.current;
    if (!cur) return;
    const i = queue.current.findIndex((t) => t.id === cur.id);
    const p = i > 0 ? queue.current[i - 1] : undefined;
    if (p) load(p, null);
  }, [load]);

  const play: PlayerApi["play"] = useCallback(
    (track, opts) => {
      const a = audio.current;
      if (!a) return;
      if (opts?.queue) queue.current = opts.queue;
      else if (!queue.current.some((t) => t.id === track.id)) queue.current = [track];
      if (currentRef.current?.id === track.id) {
        if (opts?.at != null) a.currentTime = opts.at;
        if (a.paused) a.play().catch(() => setMessage("Couldn't start playback."));
        else if (opts?.at == null) a.pause();
        return;
      }
      load(track, opts?.at ?? null);
    },
    [load],
  );

  // Media Session: lock-screen / headset controls and metadata for the current track.
  useEffect(() => {
    if (!current || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (window.MediaMetadata) {
      ms.metadata = new MediaMetadata({
        title: current.title,
        artist: current.show,
        album: current.show,
        artwork: current.artwork ? [{ src: new URL(current.artwork, location.href).href }] : [],
      });
    }
    const a = audio.current!;
    const set = (n: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(n, fn);
      } catch {
        /* unsupported action */
      }
    };
    set("play", () => void a.play());
    set("pause", () => a.pause());
    set("seekbackward", () => (a.currentTime = Math.max(0, a.currentTime - 15)));
    set("seekforward", () => (a.currentTime += 30));
    set("nexttrack", next);
    set("previoustrack", prev);
  }, [current, next, prev]);

  // Stable identity: inline players depend on it in an effect, and it must not change
  // on every time update or they would tear down and re-observe constantly.
  const setInlineVisible = useCallback((id: string, v: boolean) => {
    setVisible((s) => {
      if (s.has(id) === v) return s;
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });
  }, []);

  const api = useMemo<PlayerApi>(
    () => ({
      current,
      playing,
      time,
      duration,
      rate: RATES[rate]!,
      message,
      play,
      toggle: () => {
        const a = audio.current;
        if (!a || !currentRef.current) return;
        if (a.paused) a.play().catch(() => setMessage("Couldn't start playback."));
        else a.pause();
      },
      seekTo: (s) => {
        if (audio.current) audio.current.currentTime = Math.max(0, s);
      },
      skip: (d) => {
        const a = audio.current;
        if (a) a.currentTime = Math.max(0, Math.min(a.duration || 1e9, a.currentTime + d));
      },
      cycleRate: () => {
        const n = (rateRef.current + 1) % RATES.length;
        rateRef.current = n;
        setRate(n);
        if (audio.current) audio.current.playbackRate = RATES[n]!;
      },
      close: () => {
        const a = audio.current;
        if (a) {
          a.pause();
          a.removeAttribute("src");
          a.load();
        }
        currentRef.current = null;
        setCurrent(null);
        setPlaying(false);
        setTime(0);
        setMessage("");
      },
      setInlineVisible,
      inlineVisible: !!current && visible.has(current.id),
    }),
    [current, playing, time, duration, rate, message, play, visible, setInlineVisible],
  );

  return (
    <Ctx.Provider value={api}>
      <audio
        ref={audio}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const a = e.currentTarget;
          if (Number.isFinite(a.duration) && a.duration > 0) setDuration(a.duration);
          if (pendingAt.current != null) {
            a.currentTime = pendingAt.current;
            pendingAt.current = null;
          }
        }}
        onWaiting={() => setMessage("Loading…")}
        onPlaying={() => setMessage("")}
        onError={() => currentRef.current && setMessage("Couldn't load the audio.")}
        onEnded={next}
      />
      {children}
    </Ctx.Provider>
  );
}
