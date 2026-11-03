import { describe, expect, it } from "vitest";
import { FX_LATENCY, FxChain, biquad, biquadDb, compParams, defaultFx, fxActive, fxCurveDb, normalizeFx, type TrackFx } from "@podstudio/audio/fx";

const R = 48_000;
const sine = (n: number, f: number, amp: number, phase = 0) => {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / R + phase);
  return x;
};
const noise = (n: number, amp: number, seed = 7) => {
  let s = seed;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    x[i] = amp * ((s / 2 ** 32) * 2 - 1);
  }
  return x;
};
const rms = (x: Float32Array, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, b - a));
};
const db = (v: number) => 20 * Math.log10(v + 1e-20);
/** Run a chain over a signal in blocks of `block`, return the output aligned to the input (latency removed). */
function run(fx: TrackFx, input: Float32Array[], block: number): Float32Array[] {
  const ch = new FxChain(R, input.length, fx);
  const n = input[0]!.length;
  const outs = input.map(() => new Float32Array(n + FX_LATENCY));
  for (let i = 0; i < n + FX_LATENCY; i += block) {
    const len = Math.min(block, n + FX_LATENCY - i);
    const blk = input.map((x) => {
      const b = new Float32Array(len);
      b.set(x.subarray(Math.min(i, n), Math.min(i + len, n)));
      return b;
    });
    ch.process(blk).forEach((o, c) => outs[c]!.set(o, i));
  }
  return outs.map((o) => o.subarray(FX_LATENCY, FX_LATENCY + n));
}
const fx = (patch: (f: TrackFx) => void) => {
  const f = defaultFx();
  patch(f);
  return f;
};

describe("FX settings", () => {
  it("defaults are neutral; normalize clamps instead of wrapping and rejects other versions", () => {
    expect(fxActive(defaultFx())).toBe(false);
    expect(fxActive(fx((f) => (f.eq.mid.gainDb = 3)))).toBe(true);
    expect(fxActive(fx((f) => ((f.hpf.on = true), (f.on = false))))).toBe(false);
    const n = normalizeFx({ ...defaultFx(), hpf: { on: true, freq: 9000 }, eq: { low: { gainDb: -40, freq: 10 }, mid: { gainDb: 3, freq: 2500 }, high: { gainDb: 0, freq: 8000 } } })!;
    expect(n.hpf.freq).toBe(300);
    expect(n.eq.low).toEqual({ gainDb: -12, freq: 60 });
    expect(normalizeFx({ v: 99 })).toBeNull();
  });
});

describe("FxChain", () => {
  it("neutral settings are an exact FX_LATENCY-sample delay (bit-identical)", () => {
    const x = noise(20000, 0.3);
    const [y] = run(defaultFx(), [x], 4096);
    expect(y!.every((v, i) => v === x[i])).toBe(true);
  });

  it("output doesn't depend on block size (128-sample preview quanta vs 1-second render blocks)", () => {
    const f = fx((f) => {
      f.nr.on = true;
      f.nr.amount = 0.8;
      f.hpf.on = true;
      f.hpf.freq = 120;
      f.eq.mid.gainDb = 4;
      f.comp.on = true;
      f.comp.amount = 0.6;
    });
    const x = [noise(60000, 0.05, 3).map((v, i) => v + 0.4 * Math.sin((2 * Math.PI * 300 * i) / R) * (i % 20000 < 9000 ? 1 : 0))];
    const a = run(f, x, 128)[0]!;
    const b = run(f, x, 48000)[0]!;
    const c = run(f, x, 997)[0]!;
    expect(a.every((v, i) => v === b[i])).toBe(true);
    expect(a.every((v, i) => v === c[i])).toBe(true);
  });

  it("is deterministic and processes stereo channels independently (linked compressor)", () => {
    const f = fx((f) => ((f.nr.on = true), (f.comp.on = true)));
    const l = noise(30000, 0.2, 1);
    const r = noise(30000, 0.2, 2);
    const [a1, b1] = run(f, [l, r], 512);
    const [a2] = run(f, [l, r], 512);
    expect(a1!.every((v, i) => v === a2![i])).toBe(true);
    expect(a1!.some((v, i) => v !== b1![i])).toBe(true);
  });

  it("high-pass and low-pass are 12 dB/oct Butterworth: −3 dB at the corner, ≈ −12 dB an octave out", () => {
    const hp = biquad("hpf", 100, R);
    expect(biquadDb(hp, 100, R)).toBeCloseTo(-3.01, 1);
    expect(biquadDb(hp, 50, R)).toBeLessThan(-11.5);
    expect(biquadDb(hp, 1000, R)).toBeGreaterThan(-0.05);
    const lp = biquad("lpf", 8000, R);
    expect(biquadDb(lp, 8000, R)).toBeCloseTo(-3.01, 1);
    expect(biquadDb(lp, 16000, R)).toBeLessThan(-11);
  });

  it("EQ bands hit their gain where they should; the curve includes the filters", () => {
    const f = fx((f) => {
      f.eq.mid = { gainDb: 6, freq: 2000 };
      f.eq.low = { gainDb: -4, freq: 100 };
      f.hpf.on = true;
      f.hpf.freq = 40;
    });
    expect(fxCurveDb(f, 2000)).toBeCloseTo(6, 0);
    expect(fxCurveDb(f, 30)).toBeLessThan(-6); // the high-pass shows in the curve
    // and the audio agrees with the curve
    const x = sine(48000, 2000, 0.1);
    const y = run(f, [x], 4096)[0]!;
    expect(db(rms(y, 24000)) - db(rms(x, 24000))).toBeCloseTo(fxCurveDb(f, 2000), 0);
  });

  it("compressor follows its static curve for the documented percentage mapping", () => {
    const p = compParams(0.5); // thr −20 dBFS, ratio 3.75
    expect(p.thresholdDb).toBe(-20);
    expect(p.ratio).toBeCloseTo(3.75);
    const f = fx((f) => ((f.comp.on = true), (f.comp.amount = 0.5)));
    // a steady sine 10 dB over the threshold (peak −10 dBFS): output peak ≈ thr + 10/ratio + makeup
    const amp = Math.pow(10, -10 / 20);
    const y = run(f, [sine(R, 440, amp)], 4096)[0]!;
    let pk = 0;
    for (let i = R / 2; i < R; i++) pk = Math.max(pk, Math.abs(y[i]!));
    expect(db(pk)).toBeCloseTo(p.thresholdDb + 10 / p.ratio + p.makeupDb, 0);
  });

  it("noise reduction: steady noise between phrases drops ≥ 12 dB, the speech-like bursts keep their level (±1.5 dB)", () => {
    // reference: −40 dBFS-ish white noise everywhere, a voiced 'phrase' (harmonic stack) every other half second
    const n = 6 * R;
    const bed = noise(n, 0.02, 11);
    const voice = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (Math.floor(i / (R / 2)) % 2 === 1) for (const h of [180, 360, 540, 900, 1400]) voice[i] += (0.08 / (h / 180)) * Math.sin((2 * Math.PI * h * i) / R);
    }
    const x = bed.map((v, i) => v + voice[i]!);
    const f = fx((f) => ((f.nr.on = true), (f.nr.amount = 0.8)));
    const y = run(f, [x], 1024)[0]!;
    // measure in the last seconds (after the noise estimate settles): gaps and phrases separately
    const gaps: [number, number][] = [];
    const phrases: [number, number][] = [];
    for (let k = 6; k < 12; k++) (k % 2 ? phrases : gaps).push([k * (R / 2) + 2400, (k + 1) * (R / 2) - 2400]);
    const lvl = (sig: Float32Array, spans: [number, number][]) => db(Math.sqrt(spans.reduce((s, [a, b]) => s + rms(sig, a, b) ** 2, 0) / spans.length));
    const gapDrop = lvl(x, gaps) - lvl(y, gaps);
    const phraseChange = lvl(y, phrases) - lvl(x, phrases);
    expect(gapDrop).toBeGreaterThan(12);
    expect(Math.abs(phraseChange)).toBeLessThan(1.5);
  });

  it("amount 0 with NR on is (almost) transparent: the STFT reconstructs the input", () => {
    const f = fx((f) => ((f.nr.on = true), (f.nr.amount = 0)));
    const x = noise(30000, 0.3);
    const y = run(f, [x], 777)[0]!;
    let err = 0;
    for (let i = 4096; i < 30000; i++) err += (y[i]! - x[i]!) ** 2;
    expect(10 * Math.log10(err / (30000 - 4096))).toBeLessThan(-100);
  });
});
