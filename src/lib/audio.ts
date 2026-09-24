/** Size of mono PCM WAV audio, in MB per minute. */
export const mbPerMinute = (depth: number, rateKhz: number) => ((rateKhz * 1000 * (depth / 8) * 60) / 1e6).toFixed(1);
