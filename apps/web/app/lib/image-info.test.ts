import { describe, expect, it } from "vitest";
import { artworkProblem, avatarProblem, bannerProblem, imageInfo } from "./image-info";
import { cleanCategory } from "./podcast-categories";

function png(w: number, h: number) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, w);
  v.setUint32(20, h);
  return b;
}
function jpeg(w: number, h: number) {
  // SOI, an APP0 segment to skip, then SOF0.
  const app = [0xff, 0xe0, 0, 6, 1, 2, 3, 4];
  const sof = [0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 0, 0, 0];
  return new Uint8Array([0xff, 0xd8, ...app, ...sof, 0, 0]);
}

describe("imageInfo", () => {
  it("reads PNG dimensions", () => expect(imageInfo(png(1400, 1400))).toEqual({ type: "png", width: 1400, height: 1400 }));
  it("reads JPEG dimensions past other segments", () =>
    expect(imageInfo(jpeg(3000, 2000))).toEqual({ type: "jpeg", width: 3000, height: 2000 }));
  it("rejects other data", () => {
    expect(imageInfo(new TextEncoder().encode("GIF89a........................"))).toBeNull();
    expect(imageInfo(new Uint8Array(0))).toBeNull();
    expect(imageInfo(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

describe("artworkProblem", () => {
  it("accepts square 1400–3000", () => {
    expect(artworkProblem(imageInfo(png(1400, 1400)))).toBeNull();
    expect(artworkProblem(imageInfo(jpeg(3000, 3000)))).toBeNull();
  });
  it("explains each failure", () => {
    expect(artworkProblem(null)).toMatch(/PNG or JPEG/);
    expect(artworkProblem(imageInfo(png(1500, 1400)))).toMatch(/square.*1500×1400/);
    expect(artworkProblem(imageInfo(png(1000, 1000)))).toMatch(/between 1400/);
    expect(artworkProblem(imageInfo(png(3001, 3001)))).toMatch(/between 1400/);
  });
});

describe("cleanCategory", () => {
  it("keeps a valid pair", () => expect(cleanCategory("Sports", "Football")).toEqual({ primary: "Sports", sub: "Football" }));
  it("drops a sub that belongs elsewhere", () => expect(cleanCategory("Sports", "Drama")).toEqual({ primary: "Sports", sub: null }));
  it("rejects unknown or missing primaries", () => {
    expect(cleanCategory("Nope", null)).toBeNull();
    expect(cleanCategory("", "")).toBeNull();
    expect(cleanCategory("constructor", null)).toBeNull();
  });
});

describe("avatarProblem", () => {
  it("accepts any aspect within 200–4000 px", () => {
    expect(avatarProblem(imageInfo(png(600, 800)))).toBeNull();
    expect(avatarProblem(imageInfo(jpeg(200, 200)))).toBeNull();
  });
  it("rejects too small, too large and non-images", () => {
    expect(avatarProblem(imageInfo(png(199, 500)))).toMatch(/too small/);
    expect(avatarProblem(imageInfo(png(4001, 500)))).toMatch(/too large/);
    expect(avatarProblem(null)).toMatch(/PNG or JPEG/);
  });
});

describe("bannerProblem", () => {
  it("accepts wide images", () => {
    expect(bannerProblem(imageInfo(png(3200, 800)))).toBeNull();
    expect(bannerProblem(imageInfo(jpeg(1600, 400)))).toBeNull();
  });
  it("explains too small, too square, too wide and non-images", () => {
    expect(bannerProblem(imageInfo(png(1200, 300)))).toMatch(/too small/);
    expect(bannerProblem(imageInfo(png(2000, 1500)))).toMatch(/wide enough/);
    expect(bannerProblem(imageInfo(png(6001, 1000)))).toMatch(/too wide/);
    expect(bannerProblem(null)).toMatch(/PNG or JPEG/);
  });
});
