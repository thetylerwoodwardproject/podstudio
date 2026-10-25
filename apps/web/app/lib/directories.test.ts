import { describe, expect, it } from "vitest";
import { normalizeDirectoryUrl, readDirectoryLinks } from "./directories";

describe("normalizeDirectoryUrl", () => {
  it("accepts https links on the directory's own host", () => {
    expect(normalizeDirectoryUrl("apple", " https://podcasts.apple.com/us/podcast/x/id123 ")).toEqual({
      ok: true,
      value: "https://podcasts.apple.com/us/podcast/x/id123",
    });
    expect(normalizeDirectoryUrl("pocketCasts", "https://pca.st/abc").ok).toBe(true);
    expect(normalizeDirectoryUrl("amazon", "https://music.amazon.co.uk/podcasts/x").ok).toBe(true);
  });
  it("blank clears the link", () => {
    expect(normalizeDirectoryUrl("spotify", "  ")).toEqual({ ok: true, value: null });
  });
  it("rejects other hosts, look-alikes, http and javascript:", () => {
    expect(normalizeDirectoryUrl("spotify", "https://example.com/show/1").ok).toBe(false);
    expect(normalizeDirectoryUrl("spotify", "https://open.spotify.com.evil.test/x").ok).toBe(false);
    expect(normalizeDirectoryUrl("spotify", "https://evilopen.spotify.com.evil/x").ok).toBe(false);
    expect(normalizeDirectoryUrl("apple", "http://podcasts.apple.com/x").ok).toBe(false);
    expect(normalizeDirectoryUrl("apple", "javascript:alert(1)").ok).toBe(false);
    expect(normalizeDirectoryUrl("apple", "not a url").ok).toBe(false);
  });
  it("a wrong-directory link names the host it wanted", () => {
    const r = normalizeDirectoryUrl("overcast", "https://open.spotify.com/show/1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("overcast.fm");
  });
});

describe("readDirectoryLinks", () => {
  it("keeps only valid stored links", () => {
    expect(readDirectoryLinks({ apple: "https://podcasts.apple.com/x", spotify: "https://evil.test", bogus: "https://x", overcast: 5 })).toEqual({
      apple: "https://podcasts.apple.com/x",
    });
    expect(readDirectoryLinks(null)).toEqual({});
  });
});
