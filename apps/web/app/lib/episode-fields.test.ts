import { describe, expect, it } from "vitest";
import { parseOptionalInt, slugify } from "./episode-fields";

describe("parseOptionalInt", () => {
  it("treats blank as null (field cleared)", () => {
    expect(parseOptionalInt("")).toBeNull();
    expect(parseOptionalInt("   ")).toBeNull();
  });
  it("parses whole numbers including 0", () => {
    expect(parseOptionalInt("42")).toBe(42);
    expect(parseOptionalInt(" 0 ")).toBe(0);
  });
  it("rejects negatives, decimals, junk and absurd lengths with undefined", () => {
    for (const bad of ["-1", "1.5", "abc", "1e3", "1234567", "4 2"]) expect(parseOptionalInt(bad)).toBeUndefined();
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates, trimming edge punctuation", () => {
    expect(slugify("Dana's Draft Day Rules!")).toBe("dana-s-draft-day-rules");
  });
  it("never returns an empty slug", () => {
    expect(slugify("!!!")).toBe("episode");
    expect(slugify("日本語")).toBe("episode");
  });
});
