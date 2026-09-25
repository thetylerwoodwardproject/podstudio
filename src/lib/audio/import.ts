/*
 * Adding a track from a file the guest sent, when their upload didn't make it.
 * PCM and float WAVs at the session's rate are read a second at a time
 * straight from disk, so hour-long files never sit in memory; anything else
 * (other rates, MP3, M4A…) is decoded and resampled by the browser.
 */

import { TakeWriter, type TakeMeta } from './takes';
import { parseWav, remix, wavFloats } from './wav-read';

/**
 * Add `file` to the session `base` belongs to as `speaker`'s track, in the
 * session's format and lined up with its start.
 */
export async function importTrack(file: File, base: TakeMeta, speaker: string, onProgress?: (fraction: number) => void): Promise<TakeMeta> {
  const channels = base.channels ?? 1;
  const writer = await TakeWriter.start({
    episodeId: base.episodeId,
    kind: 'session',
    group: base.group,
    markers: base.markers,
    lineLog: base.lineLog,
    startLine: base.startLine,
    startText: base.startText,
    speaker,
    device: `File · ${file.name}`,
    // No clock to line it up by: it's taken to start with the host's track.
    startedAtServer: base.startedAtServer,
    sampleRate: base.sampleRate,
    bitDepth: base.bitDepth,
    channels,
  });
  const info = parseWav(new DataView(await file.slice(0, 64 * 1024).arrayBuffer()));
  if (info && info.sampleRate === base.sampleRate) {
    // Straight from disk, one second at a time.
    const frameBytes = (info.bitDepth / 8) * info.channels;
    const step = base.sampleRate * frameBytes;
    const end = Math.min(file.size, info.dataOffset + info.dataBytes);
    for (let o = info.dataOffset; o < end; o += step) {
      const bytes = await file.slice(o, Math.min(end, o + step)).arrayBuffer();
      writer.push(remix(wavFloats(bytes.slice(0, bytes.byteLength - (bytes.byteLength % frameBytes)), info), info.channels, channels));
      onProgress?.((o - info.dataOffset) / (end - info.dataOffset));
    }
  } else {
    // Other rates and formats: the browser decodes and resamples to the session's rate.
    const ctx = new OfflineAudioContext(1, 1, base.sampleRate);
    const audio = await ctx.decodeAudioData(await file.arrayBuffer());
    const left = audio.getChannelData(0);
    const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left;
    for (let o = 0; o < audio.length; o += base.sampleRate) {
      const n = Math.min(base.sampleRate, audio.length - o);
      const chunk = new Float32Array(n * channels);
      for (let i = 0; i < n; i++) {
        if (channels === 2) {
          chunk[i * 2] = left[o + i];
          chunk[i * 2 + 1] = right[o + i];
        } else chunk[i] = audio.numberOfChannels > 1 ? (left[o + i] + right[o + i]) / 2 : left[o + i];
      }
      writer.push(chunk);
      onProgress?.(o / audio.length);
    }
  }
  onProgress?.(1);
  return writer.finish();
}
