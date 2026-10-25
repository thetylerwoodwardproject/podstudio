import { describe, expect, it } from "vitest";
import { parseImageFile, thumbUrl } from "./image-urls";

describe("thumbUrl", () => {
  it("adds -s before the extension of our image URLs", () => {
    expect(thumbUrl("/show/artwork/0123456789ab.png")).toBe("/show/artwork/0123456789ab-s.png");
    expect(thumbUrl("/show/avatar/pid/0123456789ab.jpg")).toBe("/show/avatar/pid/0123456789ab-s.jpg");
  });
  it("leaves anything else (and null) alone", () => {
    expect(thumbUrl("https://x.test/a.png")).toBe("https://x.test/a.png");
    expect(thumbUrl(null)).toBeNull();
    expect(thumbUrl("/a/0123456789ab-s.png")).toBe("/a/0123456789ab-s.png");
  });
});

describe("parseImageFile", () => {
  it("separates the thumbnail flag from the canonical name", () => {
    expect(parseImageFile("0123456789ab.png")).toEqual({ name: "0123456789ab.png", thumb: false });
    expect(parseImageFile("0123456789ab-s.jpg")).toEqual({ name: "0123456789ab.jpg", thumb: true });
  });
  it("rejects everything else", () => {
    for (const f of ["../x.png", "0123456789ab.gif", "short.png", "0123456789ab-m.png", undefined]) expect(parseImageFile(f)).toBeNull();
  });
});
