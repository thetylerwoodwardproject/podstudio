import { describe, expect, it } from "vitest";
import { buildFeed, esc, type FeedInput } from "./feed-xml";
import { podrollXml } from "./podroll-xml";

const feed: FeedInput = {
  title: "The Mic Drop",
  link: "https://x.test/the-mic-drop",
  selfUrl: "https://x.test/the-mic-drop/feed",
  description: "d",
  language: "en",
  explicit: false,
  podcastGuid: "231977aa-2486-5243-9884-e419d6e9c589",
  locked: true,
  ownerEmail: "o@x.test",
  txt: [],
  funding: null,
  medium: null,
  updateFrequency: null,
  license: null,
  hosts: [],
  podroll: [],
  items: [],
};

describe("esc", () => {
  it("escapes all five XML specials", () => {
    expect(esc(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });
});

describe("buildFeed", () => {
  it("writes the stored podcast:guid verbatim and the lock with the owner email", () => {
    const x = buildFeed(feed);
    expect(x).toContain("<podcast:guid>231977aa-2486-5243-9884-e419d6e9c589</podcast:guid>");
    expect(x).toContain('<podcast:locked owner="o@x.test">yes</podcast:locked>');
    expect(buildFeed({ ...feed, locked: false })).toContain(">no</podcast:locked>");
  });
  it("starts with an XML declaration and declares every namespace it uses", () => {
    const x = buildFeed(feed);
    expect(x.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    for (const ns of ["xmlns:atom", "xmlns:itunes", "xmlns:podcast"]) expect(x).toContain(ns);
  });
  it("emits no items and no value/trailer tags", () => {
    const x = buildFeed(feed);
    expect(x).not.toContain("<item>");
    expect(x).not.toContain("podcast:value");
    expect(x).not.toContain("podcast:trailer");
  });
  it("writes TXT with and without a purpose, escaped", () => {
    const x = buildFeed({ ...feed, txt: [{ purpose: "verify", value: "a&b" }, { purpose: null, value: "bare" }] });
    expect(x).toContain('<podcast:txt purpose="verify">a&amp;b</podcast:txt>');
    expect(x).toContain("<podcast:txt>bare</podcast:txt>");
  });
  it("omits optional tags that are unset and includes them when set", () => {
    expect(buildFeed(feed)).not.toMatch(/funding|medium|updateFrequency|license/);
    const x = buildFeed({ ...feed, funding: { url: "https://x.test/?a=1&b=2", message: null }, medium: "podcast", updateFrequency: "weekly", license: "cc0" });
    expect(x).toContain('<podcast:funding url="https://x.test/?a=1&amp;b=2">Support the show</podcast:funding>');
    expect(x).toContain("<podcast:medium>podcast</podcast:medium>");
  });
});

describe("podrollXml", () => {
  it("is empty for no items", () => {
    expect(podrollXml([])).toBe("");
  });
  it("writes feedGuid always, feedUrl only when known, and keeps order", () => {
    const x = podrollXml([
      { feedGuid: "g1", feedUrl: null, title: "A" },
      { feedGuid: "g2", feedUrl: "https://e.test/f?a=1&b=2", title: 'B "q"' },
    ]);
    expect(x.indexOf('feedGuid="g1"')).toBeLessThan(x.indexOf('feedGuid="g2"'));
    expect(x).toContain('<podcast:remoteItem feedGuid="g1" title="A"/>');
    expect(x).toContain('feedUrl="https://e.test/f?a=1&amp;b=2" title="B &quot;q&quot;"');
  });
});

describe("buildFeed artwork, category, author", () => {
  const base = {
    title: "T", link: "l", selfUrl: "s", description: "d", language: "en", explicit: false,
    podcastGuid: "g", locked: false, ownerEmail: "o@x", txt: [], funding: null, medium: null,
    updateFrequency: null, license: null, hosts: [], podroll: [], items: [],
  };
  it("writes itunes:image, nested category and author, escaped", () => {
    const xml = buildFeed({
      ...base,
      author: "A & B",
      imageUrl: "https://h/s/artwork/abc.jpg",
      category: { primary: "Sports", sub: "Football" },
    });
    expect(xml).toContain('<itunes:image href="https://h/s/artwork/abc.jpg"/>');
    expect(xml).toContain('<itunes:category text="Sports"><itunes:category text="Football"/></itunes:category>');
    expect(xml).toContain("<itunes:author>A &amp; B</itunes:author>");
  });
  it("writes a primary-only category and omits all three when unset", () => {
    expect(buildFeed({ ...base, category: { primary: "History", sub: null } })).toContain('<itunes:category text="History"/>');
    const none = buildFeed(base);
    expect(none).not.toMatch(/itunes:(image|category|author)/);
  });
});
