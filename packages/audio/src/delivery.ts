// Delivery presets (Stage 05): what an episode is encoded to for the feed. 44.1 kHz CBR MP3.
// Loudness targets follow the channel count: −19 LUFS mono, −16 LUFS stereo, true peak ≤ −1 dBTP
// (checked again after encoding).
import { PODCAST_LOUDNESS } from "./loudness";

export const DELIVERY_PRESETS = {
  "mp3-64-mono": { label: "64 kbps mono", hint: "Speech", channels: 1, kbps: 64 },
  "mp3-96-stereo": { label: "96 kbps stereo", hint: "Speech", channels: 2, kbps: 96 },
  "mp3-128-stereo": { label: "128 kbps stereo", hint: "Speech + music", channels: 2, kbps: 128 },
  "mp3-192-stereo": { label: "192 kbps stereo", hint: "Music-heavy", channels: 2, kbps: 192 },
} as const;
export type DeliveryPreset = keyof typeof DELIVERY_PRESETS;
export const DEFAULT_DELIVERY_PRESET: DeliveryPreset = "mp3-128-stereo";
export const DELIVERY_RATE = 44100;

export const isDeliveryPreset = (v: unknown): v is DeliveryPreset => typeof v === "string" && v in DELIVERY_PRESETS;

/** Loudness target for a channel count. */
export const loudnessTarget = (channels: 1 | 2) => ({ targetLufs: channels === 1 ? PODCAST_LOUDNESS.mono : PODCAST_LOUDNESS.stereo, truePeakDb: PODCAST_LOUDNESS.truePeakDb });
