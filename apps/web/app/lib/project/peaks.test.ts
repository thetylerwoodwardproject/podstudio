import { describe, expect, it } from "vitest";
import { floatToPcm24 } from "~/lib/capture-contract";
import { PEAK_SPP, PeakBuilder, parsePeaks, rangePeak } from "./peaks";

const tone = (n: number, amp: number) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(i / 7));

describe("peaks", () => {
  it("finds min/max per block and reads them back", () => {
    const pcm = floatToPcm24(Float32Array.from([0.5, -0.25, 0, 0, ...new Array(PEAK_SPP - 4).fill(0), -1, 0.1]));
    const b = new PeakBuilder();
    b.push(pcm);
    const p = parsePeaks(b.finish())!;
    expect(p.data.length).toBe(4); // two blocks: 256 samples + a partial one
    expect(p.data[0]).toBeCloseTo(-0.25, 1);
    expect(p.data[1]).toBeCloseTo(0.5, 1);
    expect(p.data[2]).toBeCloseTo(-1, 1);
    expect(p.data[3]).toBeCloseTo(0.1, 1);
  });
  it("gives identical results however the bytes are chunked (odd splits across samples)", () => {
    const pcm = floatToPcm24(tone(5000, 0.7));
    const one = new PeakBuilder();
    one.push(pcm);
    const many = new PeakBuilder();
    for (let i = 0; i < pcm.length; ) {
      const step = 1 + ((i * 7) % 11);
      many.push(pcm.subarray(i, i + step));
      i += step;
    }
    expect(many.samples).toBe(5000);
    expect([...many.finish()]).toEqual([...one.finish()]);
  });
  it("rejects a damaged cache file and reduces ranges", () => {
    const b = new PeakBuilder();
    b.push(floatToPcm24(tone(2048, 0.5)));
    const file = b.finish();
    expect(parsePeaks(file.subarray(0, file.length - 1))).toBeNull();
    expect(parsePeaks(new Uint8Array(20))).toBeNull();
    const [lo, hi] = rangePeak(parsePeaks(file)!, 0, 2048);
    expect(hi).toBeGreaterThan(0.45);
    expect(lo).toBeLessThan(-0.45);
  });
});

describe("stereo peaks", () => {
  it("keeps left and right separately and round-trips through the cache format", async () => {
    const { PeakBuilder, parsePeaks, rangePeak, PEAK_SPP } = await import("./peaks");
    const frames = PEAK_SPP * 3;
    const bytes = new Uint8Array(frames * 6);
    const put = (o: number, f: number) => {
      const v = Math.round(f * 0x7fffff) & 0xffffff;
      bytes[o] = v & 0xff;
      bytes[o + 1] = (v >> 8) & 0xff;
      bytes[o + 2] = (v >> 16) & 0xff;
    };
    for (let i = 0; i < frames; i++) {
      put(i * 6, i < PEAK_SPP ? 0.5 : 0); // left: loud only in block 0
      put(i * 6 + 3, i >= 2 * PEAK_SPP ? -0.8 : 0); // right: loud only in block 2
    }
    const b = new PeakBuilder(2);
    b.push(bytes.subarray(0, 1001));
    b.push(bytes.subarray(1001));
    const p = parsePeaks(b.finish())!;
    expect(p.data2).toBeDefined();
    expect(rangePeak(p, 0, PEAK_SPP, 0)[1]).toBeCloseTo(0.5, 1);
    expect(rangePeak(p, 0, PEAK_SPP, 1)).toEqual([0, 0]);
    expect(rangePeak(p, 2 * PEAK_SPP, 3 * PEAK_SPP, 1)[0]).toBeCloseTo(-0.8, 1);
    expect(rangePeak(p, 2 * PEAK_SPP, 3 * PEAK_SPP, 0)).toEqual([0, 0]);
    expect(b.samples).toBe(frames);
  });
});
