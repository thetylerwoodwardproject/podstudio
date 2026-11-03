import { defaultFx, type TrackFx } from "@podstudio/audio/fx";

// Built-in podcast presets for the FX panel. Starting points from common podcast practice
// (researched 2026-11-02, see docs/HANDOFF.md): high-pass at 80–100 Hz (higher for brighter
// voices), a small cut around 200–400 Hz for mud, +1–2 dB of presence at 3–5 kHz, and a moderate
// 3:1–4:1 compressor. On our one-knob compressor (ratio = 1.5 + 4.5 × amount, threshold
// −10 − 20 × amount dBFS) 3:1 ≈ 33 % and 4:1 ≈ 55 %. Adjust by ear.

interface Spec {
  nr?: number;
  hpf?: number;
  lpf?: number;
  low?: [gainDb: number, hz: number];
  mid?: [gainDb: number, hz: number];
  high?: [gainDb: number, hz: number];
  comp?: number;
}

function build(s: Spec): TrackFx {
  const f = defaultFx();
  if (s.nr !== undefined) f.nr = { on: true, amount: s.nr };
  if (s.hpf !== undefined) f.hpf = { on: true, freq: s.hpf };
  if (s.lpf !== undefined) f.lpf = { on: true, freq: s.lpf };
  if (s.low) f.eq.low = { ...f.eq.low, gainDb: s.low[0], freq: s.low[1] };
  if (s.mid) f.eq.mid = { ...f.eq.mid, gainDb: s.mid[0], freq: s.mid[1] };
  if (s.high) f.eq.high = { ...f.eq.high, gainDb: s.high[0], freq: s.high[1] };
  if (s.comp !== undefined) f.comp = { on: true, amount: s.comp };
  return f;
}

export interface BuiltinPreset {
  id: string;
  name: string;
  /** One line on when to use it. */
  hint: string;
  fx: TrackFx;
}

export const PODCAST_PRESETS: BuiltinPreset[] = [
  { id: "voice-clean", name: "Podcast voice", hint: "A good start for most voices: rumble out, a little less mud, a touch of presence, gentle 3:1 compression.", fx: build({ hpf: 80, low: [-2, 250], mid: [2, 3500], high: [1, 10000], comp: 0.35 }) },
  { id: "voice-deep", name: "Deeper voice", hint: "Lower voices: keeps the warmth, trims the boom around 300 Hz, a bit more presence.", fx: build({ hpf: 70, low: [-2.5, 300], mid: [2, 3000], high: [1.5, 10000], comp: 0.4 }) },
  { id: "voice-bright", name: "Brighter voice", hint: "Higher voices: a higher high-pass and less top-end lift so it doesn't get harsh.", fx: build({ hpf: 100, low: [-1, 250], mid: [1, 4000], comp: 0.35 }) },
  { id: "voice-broadcast", name: "Broadcast voice", hint: "Radio-style: a little low-end weight, forward presence and air, firmer 4:1-ish compression.", fx: build({ hpf: 80, low: [1.5, 120], mid: [2.5, 3500], high: [2, 10000], comp: 0.55 }) },
  { id: "room-noisy", name: "Noisy room", hint: "Home office, fan, hum or hiss: noise reduction at 60 %, a higher high-pass, softer top.", fx: build({ nr: 0.6, hpf: 100, lpf: 14000, low: [-2, 250], mid: [2, 3500], comp: 0.4 }) },
  { id: "guest-remote", name: "Remote guest (Zoom / phone)", hint: "Thin, band-limited call audio: cleans noise, trims the extremes, lifts intelligibility around 2.5 kHz.", fx: build({ nr: 0.4, hpf: 120, lpf: 9000, low: [-2, 300], mid: [3, 2500], comp: 0.55 }) },
  { id: "cleanup-gentle", name: "Gentle cleanup", hint: "Just tidies up: light noise reduction and a high-pass, nothing else.", fx: build({ nr: 0.3, hpf: 80 }) },
  { id: "music-bed", name: "Music under voice", hint: "For a music bed: dips the 3 kHz voice range so words cut through. Pair it with Ducking.", fx: build({ mid: [-4, 3000] }) },
];
