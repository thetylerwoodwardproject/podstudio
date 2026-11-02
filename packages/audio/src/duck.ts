// Ducking DSP, shared by the export render and the browser preview. A trigger level is tracked
// with a fast peak follower (it bridges the gaps between words); while it is above the threshold
// the gain on the ducked tracks is pulled to `amountDb`, with separate attack and release
// smoothing. Pure arithmetic on the input, so a render is the same every time.
import type { DuckRule } from "./document";

export interface DuckState {
  /** Peak-follower level (linear). */
  level: number;
  /** Current smoothed gain (linear, 1 = untouched). */
  gain: number;
}

export const newDuckState = (): DuckState => ({ level: 0, gain: 1 });

/** How long the detector holds a peak, so the pauses between words don't let the music pop back up. */
const DETECTOR_RELEASE_S = 0.08;

export type DuckParams = Pick<DuckRule, "amountDb" | "thresholdDb" | "attackMs" | "releaseMs">;

/**
 * Gain (one value per input sample) to apply to the ducked tracks, given the trigger signal.
 * `state` carries over between consecutive blocks.
 */
export function duckGains(trigger: Float32Array, p: DuckParams, rate: number, state: DuckState, out: Float32Array = new Float32Array(trigger.length)): Float32Array {
  const thr = Math.pow(10, p.thresholdDb / 20);
  const low = Math.pow(10, p.amountDb / 20);
  const detDecay = Math.exp(-1 / (DETECTOR_RELEASE_S * rate));
  const aCoef = 1 - Math.exp(-1 / ((Math.max(1, p.attackMs) / 1000) * rate));
  const rCoef = 1 - Math.exp(-1 / ((Math.max(1, p.releaseMs) / 1000) * rate));
  let { level, gain } = state;
  for (let i = 0; i < trigger.length; i++) {
    const x = Math.abs(trigger[i]!);
    level = x > level ? x : level * detDecay;
    const target = level > thr ? low : 1;
    gain += (target - gain) * (target < gain ? aCoef : rCoef);
    out[i] = gain;
  }
  state.level = level;
  state.gain = gain;
  return out;
}
