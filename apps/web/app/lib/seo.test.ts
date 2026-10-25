import { describe, expect, it } from "vitest";
import { episodeJsonLd, isoDuration, pageMeta, personJsonLd, robotsTxt, showJsonLd, sitemapXml } from "./seo";

describe("isoDuration", () => {
  it("formats ISO-8601 durations", () => {
    expect(isoDuration(44)).toBe("PT44S");
    expect(isoDuration(125)).toBe("PT2M5S");
    expect(isoDuration(3600)).toBe("PT1H");
    expect(isoDuration(3725)).toBe("PT1H2M5S");
    expect(isoDuration(120)).toBe("PT2M");
  });
  it("is undefined for missing or zero", () => {
    expect(isoDuration(null)).toBeUndefined();
    expect(isoDuration(0)).toBeUndefined();
  });
});

describe("JSON-LD", () => {
  it("episode: types, media, series, and no empty keys", () => {
    const j = episodeJsonLd({
      name: "Ep",
      url: "https://x/e",
      showName: "S",
      showUrl: "https://x",
      datePublished: Date.UTC(2026, 9, 25),
      durationS: 44,
      episodeNumber: 42,
      seasonNumber: 1,
      audioUrl: "https://x/a.mp3",
      audioBytes: 10,
      people: [{ name: "Dana", role: "guest", url: "https://x/p" }, { name: "Music", role: "music" }],
    }) as any;
    expect(j["@type"]).toBe("PodcastEpisode");
    expect(j.datePublished).toBe("2026-10-25T00:00:00.000Z");
    expect(j.associatedMedia).toMatchObject({ "@type": "AudioObject", contentUrl: "https://x/a.mp3", duration: "PT44S", contentSize: "10" });
    expect(j.partOfSeason.seasonNumber).toBe(1);
    expect(j.actor).toEqual([{ "@type": "Person", name: "Dana", url: "https://x/p" }]);
    expect("description" in j).toBe(false);
  });
  it("show and person drop empty fields", () => {
    const s = showJsonLd({ name: "S", url: "u", feedUrl: "f", description: "", authors: [], sameAs: ["https://a"] }) as any;
    expect(s["@type"]).toBe("PodcastSeries");
    expect("description" in s).toBe(false);
    expect("author" in s).toBe(false);
    expect(s.sameAs).toEqual(["https://a"]);
    expect((personJsonLd({ name: "P", url: "u" }) as any)["@type"]).toBe("Person");
  });
});

describe("sitemapXml / robotsTxt", () => {
  it("escapes URLs and writes lastmod", () => {
    const x = sitemapXml([{ loc: "https://x/a?b=1&c=2", lastmod: Date.UTC(2026, 0, 2) }, { loc: "https://x/b" }]);
    expect(x).toContain("<loc>https://x/a?b=1&amp;c=2</loc>");
    expect(x).toContain("<lastmod>2026-01-02T00:00:00.000Z</lastmod>");
    expect(x.match(/<url>/g)).toHaveLength(2);
  });
  it("robots blocks the studio and points at the sitemap", () => {
    const r = robotsTxt("https://h.test");
    expect(r).toContain("Disallow: /studio/");
    expect(r).toContain("Sitemap: https://h.test/sitemap.xml");
  });
});

describe("pageMeta", () => {
  const base = { title: "T", description: "D", url: "https://x/p", siteName: "S", type: "website" as const };
  it("includes canonical, og and twitter tags", () => {
    const m = pageMeta({ ...base, image: "https://x/i.png" });
    expect(m).toContainEqual({ tagName: "link", rel: "canonical", href: "https://x/p" });
    expect(m).toContainEqual({ property: "og:image", content: "https://x/i.png" });
    expect(m).toContainEqual({ name: "twitter:card", content: "summary" });
  });
  it("noindex only when asked; long descriptions are trimmed", () => {
    expect(pageMeta(base).some((x) => (x as any).name === "robots")).toBe(false);
    expect(pageMeta({ ...base, noindex: true })).toContainEqual({ name: "robots", content: "noindex, follow" });
    const d = (pageMeta({ ...base, description: "x".repeat(500) }).find((x) => (x as any).name === "description") as any).content;
    expect(d.length).toBeLessThanOrEqual(300);
  });
});
