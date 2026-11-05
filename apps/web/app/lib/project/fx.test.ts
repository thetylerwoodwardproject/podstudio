import { beforeAll, describe, expect, it } from "vitest";
import { ensureDfnLoaded } from "@podstudio/audio/dfn-node";
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

  describe("noise reduction (DeepFilterNet)", () => {
    beforeAll(async () => {
      await ensureDfnLoaded();
    }, 60_000);

    it("keeps the constant delay and block-independence, and reduces noise between phrases while speech-like bursts keep their level", () => {
      // −34 dBFS-ish white noise everywhere; a voiced 'phrase' (harmonic stack) every other half second
      const n = 8 * R;
      const bed = noise(n, 0.02, 11);
      const voice = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        if (Math.floor(i / (R / 2)) % 2 === 1) for (const h of [180, 360, 540, 900, 1400, 2200, 3300]) voice[i] += (0.08 / (h / 180)) * Math.sin((2 * Math.PI * h * i) / R) * (1 + 0.3 * Math.sin((2 * Math.PI * 4 * i) / R));
      }
      const x = bed.map((v, i) => v + voice[i]!);
      const f = fx((f) => ((f.nr.on = true), (f.nr.amount = 1)));
      const y = run(f, [x], 480)[0]!;
      const y2 = run(f, [x], 1000)[0]!;
      expect(y2).toEqual(y); // block size doesn't matter
      const gaps: [number, number][] = [];
      for (let k = 10; k < 16; k += 2) gaps.push([k * (R / 2) + 2400, (k + 1) * (R / 2) - 2400]);
      const lvl = (sig: Float32Array, spans: [number, number][]) => db(Math.sqrt(spans.reduce((s, [a, b]) => s + rms(sig, a, b) ** 2, 0) / spans.length));
      expect(lvl(x, gaps) - lvl(y, gaps)).toBeGreaterThan(6);
    }, 60_000);

    it("amount 0 is dry audio, exactly FX_LATENCY late", () => {
      const f = fx((f) => ((f.nr.on = true), (f.nr.amount = 0)));
      const x = noise(30000, 0.3);
      expect(run(f, [x], 777)[0]).toEqual(x);
    });

    it("the wet path starts without moving audio in time (switching on mid-stream)", () => {
      const x = sine(6 * R, 220, 0.3);
      const ch = new FxChain(R, 1, fx((f) => ((f.nr.on = true), (f.nr.amount = 0.5))));
      const y = new Float32Array(x.length);
      for (let i = 0; i < x.length; i += 333) y.set(ch.process([x.slice(i, i + 333)])[0]!.subarray(0, Math.min(333, x.length - i)), i);
      ch.dispose(); // releases the model: must not throw
      y.set(y.subarray(FX_LATENCY), 0);
      let best = 0, lag = 0;
      for (let L = -200; L <= 200; L++) {
        let c = 0;
        for (let i = 3 * R; i < 4 * R; i++) c += x[i]! * y[i + L]!;
        if (c > best) {
          best = c;
          lag = L;
        }
      }
      expect(Math.abs(lag)).toBeLessThanOrEqual(2);
    }, 60_000);
  });
});

describe("downward expander", () => {
  const phrase = (n: number) => {
    // −60 dBFS-ish noise bed, a loud tone burst from 1.0 s to 1.5 s
    const x = noise(n, 0.002, 5);
    for (let i = R; i < 1.5 * R; i++) x[i] += 0.2 * Math.sin((2 * Math.PI * 300 * i) / R);
    return x;
  };
  const exp = (on = true, thr = -50, range = 12) => fx((f) => (f.exp = { on, thresholdDb: thr, rangeDb: range }));

  it("turns the gaps down by the range and leaves what is above the threshold alone", () => {
    const x = phrase(3 * R);
    const y = run(exp(), [x], 480)[0]!;
    const gapDrop = db(rms(x, 2 * R, 3 * R - 2000)) - db(rms(y, 2 * R, 3 * R - 2000));
    expect(gapDrop).toBeGreaterThan(10.5);
    expect(gapDrop).toBeLessThan(12.6);
    expect(Math.abs(db(rms(y, 52800, 67200)) - db(rms(x, 52800, 67200)))).toBeLessThan(0.3);
  });

  it("opens before the word arrives (the detector runs ahead of the audio) and never changes with block size", () => {
    const x = phrase(3 * R);
    const y = run(exp(), [x], 128)[0]!;
    // the first 3 ms of the burst must already be at full level: no soft attack eating the onset
    expect(db(rms(y, R, R + 144)) - db(rms(x, R, R + 144))).toBeGreaterThan(-0.5);
    expect(run(exp(), [x], 1000)[0]).toEqual(y);
  });

  it("off is the plain delay, and it counts as active FX when on", () => {
    const x = phrase(R);
    expect(run(fx((f) => (f.exp.on = false)), [x], 777)[0]).toEqual(x);
    expect(fxActive(exp())).toBe(true);
    expect(fxActive(exp(false))).toBe(false);
  });

  it("the high-pass comes first: rumble it removes can't hold the expander open", () => {
    const x = sine(3 * R, 30, 0.03); // −30 dBFS rumble: loud to a raw detector, ≈ −55 dBFS after a 120 Hz high-pass
    const hp = (expOn: boolean) => fx((f) => ((f.hpf = { on: true, freq: 120 }), (f.exp = { on: expOn, thresholdDb: -50, rangeDb: 12 })));
    const without = run(hp(false), [x], 480)[0]!;
    const withExp = run(hp(true), [x], 480)[0]!;
    expect(db(rms(without, 2 * R, 3 * R)) - db(rms(withExp, 2 * R, 3 * R))).toBeGreaterThan(6);
  });
});
