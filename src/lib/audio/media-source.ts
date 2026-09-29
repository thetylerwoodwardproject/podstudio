/* Imported media is already converted to PCM WAV on upload. Read the requested
 * frames directly from its Blob rather than decoding the entire file per window. */
import { WavReader } from './master.ts';
import type { EditorSourceReader } from './editor-render.ts';
export function mediaSource(load: () => Promise<Blob>): EditorSourceReader {
  let cached: Promise<Blob> | undefined;
  return {
    channels: 2, sampleRate: 48000,
    async read(from, seconds) {
      cached ??= load().catch((error) => { cached = undefined; throw error; });
      // Independent cursors allow concurrent waveform/playback/export reads.
      const reader = await WavReader.open(await cached);
      if (reader.info.channels !== 2 || reader.info.sampleRate !== 48000) throw new Error('Imported audio must be stereo 48 kHz PCM WAV.');
      reader.seek(Math.round(Math.max(0, from) * 48000));
      return reader.read(Math.round(Math.max(0, seconds) * 48000));
    },
  };
}
