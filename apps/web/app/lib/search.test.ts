import { describe, expect, it } from "vitest";
import { likePattern } from "./search";

describe("likePattern", () => {
  it("wraps plain text", () => expect(likePattern("transfer")).toBe("%transfer%"));
  it("escapes LIKE wildcards and the escape character", () => {
    expect(likePattern("100%")).toBe("%100\\%%");
    expect(likePattern("a_b")).toBe("%a\\_b%");
    expect(likePattern("c:\\x")).toBe("%c:\\\\x%");
  });
});
