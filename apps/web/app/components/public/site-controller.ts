import { useEffect, useMemo } from "react";
import type { AudioPlayerController } from "~/hooks/use-audio-player";
import { createFrameEmitter } from "~/lib/audio/frame-source";
import { usePlayer, type Track } from "./player-context";

export const SITE_RATES = [1, 1.25, 1.5, 2];

/**
 * The public site's single, navigation-surviving player, presented to audiocn's AudioPlayer as a
 * controller for one track. While another track is current, this one reads as idle and pressing
 * play (or seeking) starts it in the shared element — the inline player stays a *view*.
 * `track` null = whatever is current (the sticky bar).
 */
export function useSiteController(track: Track | null, opts: { queue?: Track[]; startAt?: number | null } = {}): AudioPlayerController {
  const p = usePlayer();
  const t = track ?? p.current;
  const mine = !!t && p.current?.id === t.id;
  const total = mine && p.duration > 0 ? p.duration : (t?.durationS ?? 0);
  const at = mine ? p.time : (opts.startAt ?? 0);
  const time = useMemo(() => createFrameEmitter<number>(), []);
  useEffect(() => time.emit(at), [time, at]);
  const { queue, startAt } = opts;
  return useMemo<AudioPlayerController>(() => {
    const start = (seconds?: number) => t && p.play(t, { queue, at: seconds ?? (mine ? undefined : (startAt ?? undefined)) });
    return {
      element: mine ? p.element() : null,
      // a not-yet-started episode is "paused", not "idle": audiocn disables controls when idle, and pressing play must start it
      status: mine && p.playing ? "playing" : "paused",
      playing: mine && p.playing,
      currentTime: at,
      duration: total,
      buffered: total,
      volume: p.volume,
      muted: p.muted,
      playbackRate: p.rate,
      loop: false,
      error: null,
      play: async () => {
        if (!mine || !p.playing) start();
      },
      pause: () => {
        if (mine && p.playing) p.toggle();
      },
      toggle: async () => {
        if (mine) p.toggle();
        else start();
      },
      seek: (s) => (mine ? p.seekTo(s) : start(s)),
      setVolume: (v) => p.setVolume(v),
      setMuted: (m) => p.setMuted(m),
      // audiocn's rate button always asks for the next rate in SITE_RATES, which is what cycleRate does
      setPlaybackRate: () => p.cycleRate(),
      setLoop: () => {},
      time,
    };
  }, [p, t, mine, at, total, queue, startAt, time]);
}
