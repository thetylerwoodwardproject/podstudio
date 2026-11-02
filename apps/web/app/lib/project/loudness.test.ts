import { describe, expect, it } from "vitest";
import { kWeighting, LoudnessMeter, TruePeakLimiter, TruePeakMeter } from "@podstudio/audio/loudness";

const R = 48_000;
const sine = (seconds: number, freq: number, peakDb: number, phase = 0, rate = R) => {
  const a = Math.pow(10, peakDb / 20);
  const x = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < x.length; i++) x[i] = a * Math.sin((2 * Math.PI * freq * i) / rate + phase);
  return x;
};
const measure = (chs: Float32Array[], rate = R) => {
  const m = new LoudnessMeter(rate, chs.length);
  // in uneven pieces, to exercise the streaming
  for (let i = 0; i < chs[0]!.length; i += 7777) m.push(chs.map((c) => c.subarray(i, i + 7777)));
  return m;
};

describe("BS.1770 loudness", () => {
  it("K-weighting matches the published 48 kHz coefficients", () => {
    const [shelf, hp] = kWeighting(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 6);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 6);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 6);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 6);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 6);
    expect(hp.b0).toBeCloseTo(1, 6);
    expect(hp.b1).toBeCloseTo(-2, 6);
    expect(hp.b2).toBeCloseTo(1, 6);
    expect(hp.a1).toBeCloseTo(-1.99004745483398, 6);
    expect(hp.a2).toBeCloseTo(0.99007225036621, 6);
  });

  it("EBU Tech 3341 case 1: stereo 1 kHz sine at −23 dBFS reads −23.0 LUFS (momentary, short-term, integrated)", () => {
    const x = sine(20, 1000, -23);
    const m = measure([x, x]);
    expect(m.integrated()).toBeCloseTo(-23, 1);
    expect(m.momentary()).toBeCloseTo(-23, 1);
    expect(m.shortTerm()).toBeCloseTo(-23, 1);
  });

  it("the same at 44.1 kHz", () => {
    const x = sine(20, 1000, -23, 0, 44100);
    expect(measure([x, x], 44100).integrated()).toBeCloseTo(-23, 1);
  });

  it("mono reads 3 LU lower than the same signal as dual-mono stereo (why mono −19 ≈ stereo −16)", () => {
    const x = sine(10, 1000, -20);
    expect(measure([x, x]).integrated() - measure([x]).integrated()).toBeCloseTo(3.01, 1);
  });

  it("gating: silence and very quiet passages don't drag the integrated value down", () => {
    const loud = sine(20, 1000, -20);
    const withSilence = new Float32Array(loud.length * 2);
    withSilence.set(loud);
    const a = measure([loud]).integrated();
    const b = measure([withSilence]).integrated();
    expect(Math.abs(a - b)).toBeLessThan(0.05);
    // a passage 30 LU down is below the relative gate too
    const quiet = sine(20, 1000, -50);
    const mixed = new Float32Array(loud.length + quiet.length);
    mixed.set(loud);
    mixed.set(quiet, loud.length);
    expect(Math.abs(measure([mixed]).integrated() - a)).toBeLessThan(0.05);
  });

  it("all silence is −∞, not a number that would drive the gain", () => {
    expect(measure([new Float32Array(R * 5)]).integrated()).toBe(Number.NEGATIVE_INFINITY);
  });

  it("LRA: a steady tone has ~0 LU range; alternating 10 LU steps give ~10", () => {
    expect(measure([sine(30, 1000, -20)]).lra()).toBeLessThan(0.2);
    const parts: Float32Array[] = [];
    for (let i = 0; i < 6; i++) parts.push(sine(10, 1000, i % 2 ? -30 : -20));
    const x = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      x.set(p, o);
      o += p.length;
    }
    expect(measure([x]).lra()).toBeGreaterThan(9);
    expect(measure([x]).lra()).toBeLessThan(10.5);
  });
});

describe("true peak", () => {
  it("finds the peak between samples: fs/4 sine at 45° has sample peak −3 dB but true peak 0 dB", () => {
    const x = sine(1, R / 4, 0, Math.PI / 4);
    let sp = 0;
    for (const v of x) sp = Math.max(sp, Math.abs(v));
    expect(20 * Math.log10(sp)).toBeCloseTo(-3.01, 1);
    const t = new TruePeakMeter(1);
    for (let i = 0; i < x.length; i += 1000) t.push([x.subarray(i, i + 1000)]);
    expect(t.db()).toBeGreaterThan(-0.4);
    expect(t.db()).toBeLessThan(0.2);
  });
});

describe("true-peak limiter", () => {
  const run = (x: Float32Array, ceilDb: number) => {
    const lim = new TruePeakLimiter(R, 1, ceilDb);
    const parts: Float32Array[] = [];
    for (let i = 0; i < x.length; i += 4096) parts.push(lim.process([x.subarray(i, i + 4096)])[0]!);
    parts.push(lim.flush()[0]!);
    const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      all.set(p, o);
      o += p.length;
    }
    return { lim, out: all.subarray(lim.latency) }; // drop the start-up delay: aligned with the input
  };

  it("is exactly transparent (just delayed) when nothing is near the ceiling", () => {
    const x = sine(3, 440, -12);
    const { out, lim } = run(x, -1);
    expect(out.length).toBe(x.length);
    let worst = 0;
    for (let i = 0; i < x.length; i++) worst = Math.max(worst, Math.abs(out[i]! - x[i]!));
    expect(worst).toBe(0);
    expect(lim.limited).toBe(0);
  });

  it("holds the true peak at the ceiling on hot material, without touching quiet parts", () => {
    // speech-like: a quiet bed with loud bursts that overshoot by 6 dB, including inter-sample overs
    const x = sine(6, 997, -20);
    const burst = sine(0.25, R / 4 - 50, 5, Math.PI / 4);
    for (const at of [1, 2.5, 4]) x.set(burst, Math.round(at * R));
    const { out } = run(x, -1);
    const tp = new TruePeakMeter(1);
    tp.push([out]);
    expect(tp.db()).toBeLessThan(-0.85);
    // a stretch well away from any burst is untouched
    for (let i = Math.round(0.2 * R); i < Math.round(0.8 * R); i++) expect(out[i]).toBe(x[i]);
  });
});
