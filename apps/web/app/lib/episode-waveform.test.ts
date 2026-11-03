import { describe, expect, it } from "vitest";
import { reducePeaks } from "./waveform-peaks";

describe("reducePeaks", () => {
  it("keeps the loudest block in each bar and scales the loudest bar to 1", () => {
    const blocks = Float32Array.from([0.1, 0.5, 0.2, 0.25, 0, 0]);
    expect(reducePeaks(blocks, 3)).toEqual([1, 0.5, 0]);
  });
  it("returns the requested number of bars even for very short audio", () => {
    const r = reducePeaks(Float32Array.from([0.4]), 10);
    expect(r).toHaveLength(10);
    expect(Math.max(...r)).toBe(1);
  });
  it("is all zeros for silence", () => {
    expect(reducePeaks(new Float32Array(50), 5)).toEqual([0, 0, 0, 0, 0]);
  });
});
