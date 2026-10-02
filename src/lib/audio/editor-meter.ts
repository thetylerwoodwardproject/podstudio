/** Sample-peak envelopes from the processed stereo signal of one editor track. */
export interface TrackMeterWindow {
  from: number;
  stepSeconds: number;
  channels: 1 | 2;
  /** Interleaved linear peaks; mono windows contain one value per step. */
  peaks: Float32Array;
}

export type EditorMeterWindows = Record<string, TrackMeterWindow>;

export function trackMeterWindow(audio: Float32Array, channels: 1 | 2, rate: number, from: number): TrackMeterWindow {
  const stepFrames = Math.max(1, Math.round(rate / 20));
  const frames = Math.floor(audio.length / 2);
  const peaks = new Float32Array(Math.ceil(frames / stepFrames) * channels);
  for (let frame = 0; frame < frames; frame++) {
    const index = Math.floor(frame / stepFrames) * channels;
    peaks[index] = Math.max(peaks[index], Math.abs(audio[frame * 2]));
    if (channels === 2) peaks[index + 1] = Math.max(peaks[index + 1], Math.abs(audio[frame * 2 + 1]));
  }
  return { from, stepSeconds: stepFrames / rate, channels, peaks };
}

/** Stereo output peaks from the actual mono or stereo PCM sent to the player. */
export function outputMeterWindow(audio: Float32Array, inputChannels: 1 | 2, rate: number, from: number): TrackMeterWindow {
  const stepFrames = Math.max(1, Math.round(rate / 20));
  const frames = Math.floor(audio.length / inputChannels);
  const peaks = new Float32Array(Math.ceil(frames / stepFrames) * 2);
  for (let frame = 0; frame < frames; frame++) {
    const index = Math.floor(frame / stepFrames) * 2;
    const left = Math.abs(audio[frame * inputChannels]);
    peaks[index] = Math.max(peaks[index], left);
    peaks[index + 1] = Math.max(peaks[index + 1], inputChannels === 2 ? Math.abs(audio[frame * 2 + 1]) : left);
  }
  return { from, stepSeconds: stepFrames / rate, channels: 2, peaks };
}

export function meterDbfs(window: TrackMeterWindow | undefined, at: number, channel = 0): number {
  if (!window || at < window.from || channel >= window.channels) return -Infinity;
  const index = Math.floor((at - window.from) / window.stepSeconds + 1e-7) * window.channels + channel;
  const peak = window.peaks[index] ?? 0;
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/** Concatenate adjacent render chunks without retaining their PCM. */
export function joinMeterWindows(windows: TrackMeterWindow[]): TrackMeterWindow | undefined {
  if (!windows.length) return undefined;
  const first = windows[0];
  const peaks = new Float32Array(windows.reduce((total, window) => total + window.peaks.length, 0));
  let offset = 0;
  for (const window of windows) { peaks.set(window.peaks, offset); offset += window.peaks.length; }
  return { from: first.from, stepSeconds: first.stepSeconds, channels: first.channels, peaks };
}
