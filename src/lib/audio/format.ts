/** Size of PCM WAV audio, in MB per minute. */
export const mbPerMinute = (depth: number, rateKhz: number, channels = 1) =>
  ((rateKhz * 1000 * (depth / 8) * channels * 60) / 1e6).toFixed(1);

export const channelsLabel = (channels: number) => (channels === 2 ? 'Stereo' : 'Mono');
