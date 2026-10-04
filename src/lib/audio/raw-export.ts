import {blobSink} from './blob-sink';
import { rawRanges } from './raw-ranges';
export { rawRanges } from './raw-ranges';
import { mapTime, onAudio } from './assemble';
import { rangesWav, type TakeMeta } from './takes';
import { lineUp } from './line-up';
import { WavReader } from './master';
import { mixTones, type PlacedTone, type ToneKind, type ToneSettings } from './tones';
import { pcmBytes, wavHeader } from './wav';

export async function rawRecordingWav(host: TakeMeta, track: TakeMeta, settings: ToneSettings, variant?: string): Promise<Blob> {
  const ranges = rawRanges(host);
  const base = await rangesWav(track, track.id === host.id ? ranges : lineUp(host).ranges(track, ranges), [], variant, [], null);
  if (track.id !== host.id || variant) return base;
  const kinds = (Object.keys(settings.kinds) as ToneKind[]).filter((k) => settings.kinds[k]);
  const tones: PlacedTone[] = onAudio(host.markers ?? [], []).markers.filter((m) => kinds.includes(m.kind as ToneKind) && !(m.kind === 'cut' && m.who === 'guest')).flatMap((m) => {
    const at = mapTime(m.t, ranges); return at == null ? [] : [{ at: Math.round(at * host.sampleRate), kind: m.kind as ToneKind }];
  });
  const reader = await WavReader.open(base); const sink=await blobSink();await sink.write(wavHeader(reader.frames,{sampleRate:host.sampleRate,channels:reader.info.channels as 1|2,bitDepth:reader.info.bitDepth as 16|24})); let frame = 0;
  for (let samples = await reader.read(host.sampleRate * 5); samples.length; samples = await reader.read(host.sampleRate * 5)) {
    await sink.write(pcmBytes(mixTones(samples, reader.info.channels, host.sampleRate, frame, tones, settings), reader.info.bitDepth as 16 | 24));
    frame += samples.length / reader.info.channels;
  }
  return sink.finish();
}
