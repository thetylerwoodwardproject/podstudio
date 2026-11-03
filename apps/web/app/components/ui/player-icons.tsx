import { faPause, faPlay, faRotateLeft, faRotateRight, faVolumeHigh, faVolumeLow, faVolumeXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { VolumeControlMute, VolumeControlSlider } from "~/components/ui/volume-control";
import { AudioPlayerSeek, AudioPlayerVolume, useAudioPlayerContext } from "~/components/ui/audio-player";
import { Waveform, WaveformCanvas, WaveformCursor, WaveformHover } from "~/components/ui/waveform";
import { cn } from "~/lib/utils";

// Font Awesome icons for audiocn's AudioPlayer parts (its demos pass their own icons; the
// parts themselves fall back to text labels). Shared by the public players and the embed.

/** Rotate arrow with the seconds inside, the usual podcast skip button. */
export function SkipIcon({ dir, seconds }: { dir: "back" | "forward"; seconds: number }) {
  return (
    <span className="relative inline-flex size-6 items-center justify-center" aria-hidden>
      <FontAwesomeIcon icon={dir === "back" ? faRotateLeft : faRotateRight} className="size-5!" />
      <span className="absolute inset-0 flex items-center justify-center pt-px font-mono text-[7.5px] font-bold leading-none">{seconds}</span>
    </span>
  );
}

/** audiocn's volume control with a speaker icon that follows the level. */
export function PlayerVolume({ className, slider = true }: { className?: string; slider?: boolean }) {
  const player = useAudioPlayerContext();
  const icon = player.muted || player.volume === 0 ? faVolumeXmark : player.volume < 0.5 ? faVolumeLow : faVolumeHigh;
  return (
    <AudioPlayerVolume className={cn(slider ? "w-32" : "w-auto", className)} data-testid="player-volume">
      <VolumeControlMute>
        <FontAwesomeIcon icon={icon} />
      </VolumeControlMute>
      {slider && <VolumeControlSlider className="player-volume-slider" />}
    </AudioPlayerVolume>
  );
}

export { faPause, faPlay };

/**
 * audiocn's Waveform as the player's seek bar: the episode's own waveform, played part in the
 * accent, a cursor, and the time under the pointer. Falls back to audiocn's slider without peaks.
 */
export function PlayerWaveform({ peaks, loading, duration, className, barWidth = 3, barGap = 2, hover = true, format, variant = "bars" }: { peaks: number[] | null; loading: boolean; duration: number; className?: string; barWidth?: number; barGap?: number; hover?: boolean; format?: (s: number) => string; variant?: "bars" | "mirror" | "line" }) {
  const player = useAudioPlayerContext();
  if (!peaks && !loading) return <AudioPlayerSeek className={cn("flex-1", className)} aria-label="Seek" />;
  return (
    <Waveform
      peaks={peaks}
      duration={duration}
      currentTime={player.currentTime}
      time={player.time}
      onSeekCommitted={(t) => player.seek(t)}
      loading={loading}
      barWidth={barWidth}
      barGap={barGap}
      barRadius={Math.min(barWidth / 2, 1.5)}
      variant={variant}
      aria-label="Seek"
      className={cn("h-20 rounded-md", className)}
      data-testid="player-waveform"
    >
      <WaveformCanvas />
      <WaveformCursor />
      {hover && <WaveformHover format={format} />}
    </Waveform>
  );
}

/** "0:12 | 15:01": elapsed and length, the way podcast players show it. */
export function PlayerClock({ format, className, testid }: { format: (s: number) => string; className?: string; testid?: string }) {
  const player = useAudioPlayerContext();
  return (
    <span className={cn("whitespace-nowrap font-mono text-[12px] tabular-nums text-muted-foreground", className)} data-testid={testid}>
      <span className="text-foreground">{format(player.currentTime)}</span>
      <span className="mx-1.5 inline-block h-3 w-px translate-y-0.5 bg-border" aria-hidden />
      {format(player.duration)}
    </span>
  );
}
