import { describe, expect, it } from "vitest";
import { analyseChunks } from "./recording-chunks";

const c = (sequence: number, firstSample: number, sampleCount = 100) => ({ sequence, firstSample, sampleCount });

describe("analyseChunks", () => {
  it("a complete run", () => {
    const a = analyseChunks([c(0, 0), c(1, 100), c(2, 200, 40)]);
    expect(a).toMatchObject({ prefixChunks: 3, prefixSamples: 240, gaps: [], misaligned: [], totalChunks: 3, complete: true });
  });
  it("order of arrival doesn't matter", () => {
    expect(analyseChunks([c(2, 200), c(0, 0), c(1, 100)]).complete).toBe(true);
  });
  it("reports a missing middle chunk and keeps only the prefix before it", () => {
    const a = analyseChunks([c(0, 0), c(2, 200), c(3, 300)]);
    expect(a.gaps).toEqual([{ fromSequence: 1, toSequence: 1 }]);
    expect(a.prefixChunks).toBe(1);
    expect(a.prefixSamples).toBe(100);
    expect(a.complete).toBe(false);
  });
  it("reports several gaps", () => {
    const a = analyseChunks([c(0, 0), c(3, 300), c(4, 400), c(7, 700)]);
    expect(a.gaps).toEqual([{ fromSequence: 1, toSequence: 2 }, { fromSequence: 5, toSequence: 6 }]);
  });
  it("a missing first chunk leaves no usable prefix", () => {
    const a = analyseChunks([c(1, 100), c(2, 200)]);
    expect(a.gaps).toEqual([{ fromSequence: 0, toSequence: 0 }]);
    expect(a.prefixChunks).toBe(0);
  });
  it("flags chunks whose sample positions don't line up", () => {
    const a = analyseChunks([c(0, 0), c(1, 150), c(2, 250)]);
    expect(a.misaligned).toEqual([1]);
    expect(a.prefixChunks).toBe(1);
    expect(a.complete).toBe(false);
  });
  it("empty", () => expect(analyseChunks([])).toMatchObject({ prefixChunks: 0, gaps: [], complete: true, totalChunks: 0 }));
});
