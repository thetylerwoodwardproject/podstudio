import { describe, expect, it } from "vitest";
import { toneSample, toneLength } from "~/lib/capture-contract";
import { proposeCut } from "./retake";

const R = 48_000;
/** Deterministic speech-like burst: a few harmonics with a syllable-rate envelope, plus noise floor everywhere. */
function scene(parts: { speech?: [number, number]; tone?: number }[], seconds: number, noise = 0.0008) {
  const x = new Float32Array(seconds * R);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  for (let i = 0; i < x.length; i++) x[i] = noise * rnd();
  for (const p of parts) {
    if (p.speech) {
      const [a, b] = p.speech;
      for (let i = Math.round(a * R); i < Math.round(b * R); i++) {
        const t = i / R;
        const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t);
        x[i]! += 0;
        x[i] = x[i]! + 0.18 * env * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 360 * t) + 0.3 * Math.sin(2 * Math.PI * 900 * t));
      }
    }
    if (p.tone !== undefined) for (let i = 0; i < toneLength(R); i++) x[Math.round(p.tone * R) + i] += toneSample(i, R);
  }
  return x;
}
const secs = (n: number) => n / R;

describe("proposeCut", () => {
  // good 0–2 s | pause | flub 3–5 s, 5.3–6.0 s (a short pause inside it) | pause | K at 6.2 s | pause | redo from 7.3 s
  const sig = scene([{ speech: [0, 2] }, { speech: [3, 5] }, { speech: [5.3, 6.0] }, { tone: 6.2 }, { speech: [7.3, 10] }], 12);

  it("cuts from the start of the flubbed phrase to the start of the redo, leaving a short pause on each side", () => {
    const c = proposeCut(sig, 0, Math.round(6.2 * R), R);
    expect(c.toneFound).toBe(true);
    expect(secs(c.toneStart)).toBeCloseTo(6.2, 1);
    expect(secs(c.from)).toBeGreaterThan(2.8);
    expect(secs(c.from)).toBeLessThan(3.0); // just before the flubbed phrase, not into the good one
    expect(secs(c.to)).toBeGreaterThan(7.1);
    expect(secs(c.to)).toBeLessThan(7.3); // just before the redo
    expect(c.startLimited || c.endLimited).toBe(false);
  });
  it("doesn't swallow the good sentence before the flub", () => {
    const c = proposeCut(sig, 0, Math.round(6.2 * R), R);
    expect(secs(c.from)).toBeGreaterThan(2.0 + 0.5);
  });
  it("works on a window cut out of a longer file (window offset)", () => {
    const start = 2 * R;
    const c = proposeCut(sig.subarray(start, start + 8 * R), start, Math.round(6.2 * R), R);
    expect(secs(c.from)).toBeGreaterThan(2.8);
    expect(secs(c.from)).toBeLessThan(3.0);
  });
  it("falls back to the mark when the tone isn't in the audio, and says so", () => {
    const noTone = scene([{ speech: [3, 6] }, { speech: [7.3, 9] }], 12);
    const c = proposeCut(noTone, 0, Math.round(6.2 * R), R);
    expect(c.toneFound).toBe(false);
    expect(c.toneStart).toBe(Math.round(6.2 * R));
    expect(c.from).toBeLessThanOrEqual(c.toneStart);
    expect(c.to).toBeGreaterThanOrEqual(c.toneEnd);
  });
  it("when the speaker said nothing before the tone, it cuts just the tone and the pause after", () => {
    const only = scene([{ tone: 4 }, { speech: [5, 8] }], 10);
    const c = proposeCut(only, 0, 4 * R, R);
    expect(secs(c.from)).toBeGreaterThan(3.9);
    expect(secs(c.to)).toBeGreaterThan(4.25);
    expect(secs(c.to)).toBeLessThan(5.0);
  });
  it("when K was pressed mid-phrase, the rest of the phrase after the tone is cut too, up to just before the redo", () => {
    // flub 3–7 s with the tone laid over it at 6.2 s; the speaker finishes the phrase to 6.9 s; pause; redo from 7.8 s
    const mid = scene([{ speech: [0, 2] }, { speech: [3, 6.9] }, { tone: 6.2 }, { speech: [7.8, 10] }], 12);
    const c = proposeCut(mid, 0, Math.round(6.2 * R), R);
    expect(c.toneFound).toBe(true);
    expect(secs(c.to)).toBeGreaterThan(7.55); // not stopping at the tone (6.45) and leaving the tail behind
    expect(secs(c.to)).toBeLessThan(7.8);
    expect(secs(c.from)).toBeGreaterThan(2.8);
    expect(secs(c.from)).toBeLessThan(3.0);
  });
  it("flags a search that hit its limit instead of pretending to know", () => {
    const talk = scene([{ speech: [0, 6] }, { tone: 6.2 }, { speech: [7, 9] }], 10);
    const c = proposeCut(talk, 0, Math.round(6.2 * R), R, { minPauseMs: 350, keepPauseMs: 150, maxLookbackS: 3, maxLookaheadS: 6 });
    expect(c.startLimited).toBe(true);
    expect(secs(c.from)).toBeGreaterThanOrEqual(3.1);
  });
  it("never returns a range that excludes the tone", () => {
    for (const at of [1, 3.3, 5.5, 8]) {
      const s = scene([{ speech: [0, 4] }, { tone: at }, { speech: [at + 1, at + 3] }], 14);
      const c = proposeCut(s, 0, Math.round(at * R), R);
      expect(c.from).toBeLessThanOrEqual(c.toneStart);
      expect(c.to).toBeGreaterThanOrEqual(c.toneEnd);
    }
  });
});
