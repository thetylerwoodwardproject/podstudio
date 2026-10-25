import { describe, expect, it } from "vitest";
import { parseRange } from "./http-range";

describe("parseRange", () => {
  it("returns null without a usable header", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("items=0-5", 100)).toBeNull();
    expect(parseRange("bytes=0-5,10-20", 100)).toBeNull();
    expect(parseRange("bytes=-", 100)).toBeNull();
  });
  it("parses closed, open-ended and suffix ranges", () => {
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });
  it("clamps the end and an oversized suffix", () => {
    expect(parseRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
  });
  it("flags unsatisfiable ranges", () => {
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=20-10", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 100)).toBe("unsatisfiable");
  });
});
