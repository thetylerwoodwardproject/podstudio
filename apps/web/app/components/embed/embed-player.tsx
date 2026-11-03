import { useCallback, useEffect, useRef, useState } from "react";
import { AudioPlayer, AudioPlayerPlay, AudioPlayerRate, AudioPlayerSkipBack, AudioPlayerSkipForward, AudioPlayerTime } from "~/components/ui/audio-player";
import { PlayerWaveform, SkipIcon } from "~/components/ui/player-icons";
import { useEpisodeWaveform } from "~/components/public/use-episode-waveform";
import { playIcon } from "~/components/ui/play-icon";
import { TrackList, TrackListItem, TrackListItemContent, TrackListItemDuration, TrackListItemIndex, TrackListItemTitle } from "~/components/ui/track-list";
import { useAudioPlayer } from "~/hooks/use-audio-player";
import { embedThemeCss, fmtTime, type EmbedOptions, type EmbedView } from "~/lib/embed-player";
import { thumbUrl } from "~/lib/image-urls";

const RATES = [1, 1.25, 1.5, 2];

/** Messages to the host page: podstudio:resize (height) and podstudio:play|pause|ended|timeupdate ({ id, currentTime, duration }). */
function post(m: Record<string, unknown>) {
  try {
    window.parent.postMessage(m, "*");
  } catch {
    // no parent (opened directly)
  }
}

/**
 * The embeddable player (`/{show}/embed/*`), built from audiocn's AudioPlayer (and TrackList for a
 * whole-show playlist): play/pause, −15 / +30, scrubber, time, speed, Media Session, and
 * auto-resize + play/pause/ended/timeupdate messages for embed.js. An episode without a verified
 * MP3 says "Audio isn't available" instead of showing a dead play button.
 */
export function EmbedPlayer({ view, options: o }: { view: EmbedView; options: EmbedOptions }) {
  const eps = view.episodes;
  const firstPlayable = eps.findIndex((e) => e.audioUrl);
  const [cur, setCur] = useState(Math.max(0, firstPlayable));
  const [message, setMessage] = useState("");
  const ep = eps[cur];
  const playable = firstPlayable >= 0;
  const pending = useRef(false);
  const wave = useEpisodeWaveform(ep?.audioUrl);

  const duration = () => (player.duration > 0 ? player.duration : (ep?.durationS ?? 0));
  const send = (type: string) => post({ type: `podstudio:${type}`, id: ep?.id ?? null, currentTime: player.currentTime, duration: duration() });
  const player = useAudioPlayer({
    src: ep?.audioUrl ?? undefined,
    preload: "none",
    onPlay: () => {
      setMessage("");
      send("play");
    },
    onPause: () => send("pause"),
    onError: () => setMessage("Couldn't load the audio."),
    onEnded: () => {
      send("ended");
      let n = cur + 1;
      while (n < eps.length && !eps[n]!.audioUrl) n++;
      if (n < eps.length) select(n);
    },
  });

  const select = useCallback((i: number) => {
    pending.current = true;
    setCur(i);
  }, []);
  // start the newly chosen episode once its source is in
  useEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    player.play().catch(() => setMessage("Couldn't start playback."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur]);

  // auto-resize: the host's iframe follows this document's height
  useEffect(() => {
    const size = () => post({ type: "podstudio:resize", height: document.documentElement.scrollHeight });
    size();
    const ro = new ResizeObserver(size);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);

  // lock-screen / headset controls
  const art = thumbUrl(ep?.artworkUrl ?? view.artworkUrl) ?? null;
  useEffect(() => {
    if (!("mediaSession" in navigator) || !ep) return;
    const ms = navigator.mediaSession;
    if (typeof MediaMetadata !== "undefined") ms.metadata = new MediaMetadata({ title: ep.title, artist: view.showTitle, album: view.showTitle, artwork: art ? [{ src: art }] : [] });
    const h = (n: MediaSessionAction, fn: MediaSessionActionHandler) => {
      try {
        ms.setActionHandler(n, fn);
      } catch {
        // unsupported action
      }
    };
    h("play", () => void player.play());
    h("pause", () => player.pause());
    h("seekbackward", () => player.seek(Math.max(0, player.currentTime - 15)));
    h("seekforward", () => player.seek(player.currentTime + 30));
  }, [ep, art, view.showTitle, player]);

  const label = view.mode === "single" && ep?.number != null ? `${view.showTitle} · Ep. ${ep.number}` : view.showTitle;

  // Same layout as the site's episode player: big play beside the waveform, then skips + speed
  // and "elapsed | length".
  const length = player.duration > 0 ? player.duration : (ep?.durationS ?? 0);
  const controls = playable ? (
    <AudioPlayer player={player} className="emb-ctl mt-auto w-full flex-col items-stretch gap-1.5 pt-3" aria-label={ep ? `Player: ${ep.title}` : "Player"} onTimeUpdate={() => send("timeupdate")} data-testid="embed-player">
      <div className="flex items-center gap-3">
        <AudioPlayerPlay className="size-12 shrink-0 text-base" data-testid="embed-play">{playIcon}</AudioPlayerPlay>
        <PlayerWaveform peaks={wave.peaks} loading={wave.loading} duration={length} variant="mirror" barWidth={2} barGap={1} format={(sec) => fmtTime(sec)} className="h-11 min-w-0 flex-1" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-0.5">
          <AudioPlayerSkipBack seconds={15} className="emb-skip size-8" aria-label="Back 15 seconds"><SkipIcon dir="back" seconds={15} /></AudioPlayerSkipBack>
          <AudioPlayerSkipForward seconds={30} className="emb-skip size-8" aria-label="Forward 30 seconds"><SkipIcon dir="forward" seconds={30} /></AudioPlayerSkipForward>
          <AudioPlayerRate rates={RATES} aria-label="Playback speed" className="ml-1 text-[12.5px]" />
        </div>
        <span className="whitespace-nowrap font-mono text-[12px] tabular-nums text-muted-foreground">
          <AudioPlayerTime format={(sec) => fmtTime(sec)} className="text-foreground" data-testid="embed-time" />
          <span className="mx-1.5 inline-block h-3 w-px translate-y-0.5 bg-border" aria-hidden />
          {fmtTime(length)}
        </span>
      </div>
    </AudioPlayer>
  ) : (
    <div className="mt-2.5 text-[13px] text-muted-foreground" data-testid="embed-unavailable">Audio isn't available{view.mode === "playlist" ? " yet" : " for this episode yet"}.</div>
  );

  return (
    <>
      <style>{embedThemeCss(o)}</style>
      <div className="emb overflow-hidden rounded-[14px] border border-border bg-background text-foreground" data-testid="embed-card">
        {o.player === "video" && (
          <div className="emb-stage" role="img" aria-label="Video not available">
            <i className="b1" />
            <i className="b2" />
            <i className="b3" />
            <span>Video not available</span>
          </div>
        )}
        <div className="emb-main flex gap-4 p-4">
          {art ? <img className="emb-art" src={art} alt="" width={104} height={104} /> : <div className="emb-art" aria-hidden />}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between gap-2.5">
              <a className="truncate text-[12px] text-muted-foreground no-underline hover:text-foreground" href={view.showUrl} target="_blank" rel="noopener">{label}</a>
              {o.follow && (
                <a className="shrink-0 rounded-full border border-border px-3 py-0.5 text-[12px] font-semibold text-foreground no-underline hover:border-muted-foreground" href={view.showUrl} target="_blank" rel="noopener" data-testid="embed-follow">Follow</a>
              )}
            </div>
            <h1 className="mt-1 truncate text-[18px] font-bold leading-tight tracking-[-0.015em]" data-testid="embed-title">
              {view.mode === "single" ? ep ? <a className="text-inherit no-underline hover:underline" href={ep.url} target="_blank" rel="noopener">{ep.title}</a> : "No episode yet" : (eps.length > 1 && ep ? ep.title : view.showTitle)}
            </h1>
            {view.mode === "single" && controls}
            {message && <div className="mt-2 text-[13px] text-muted-foreground" role="status">{message}</div>}
          </div>
        </div>
        {view.mode === "playlist" && (
          <>
            <div className="px-4 pb-1">{controls}</div>
            <TrackList size="sm" className="max-h-[216px] overflow-y-auto border-t border-border p-1" aria-label="Episodes" data-testid="embed-list">
              {eps.map((e, i) => (
                <TrackListItem key={e.id ?? i} active={i === cur} playing={i === cur && player.playing} disabled={!e.audioUrl} onSelect={() => (i === cur ? void player.toggle() : select(i))} data-testid="embed-item">
                  <TrackListItemIndex>{e.number ?? ""}</TrackListItemIndex>
                  <TrackListItemContent>
                    <TrackListItemTitle>{e.title}</TrackListItemTitle>
                  </TrackListItemContent>
                  <TrackListItemDuration>{e.durationS ? fmtTime(e.durationS) : ""}</TrackListItemDuration>
                </TrackListItem>
              ))}
            </TrackList>
          </>
        )}
      </div>
    </>
  );
}
