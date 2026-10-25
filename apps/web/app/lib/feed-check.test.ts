import { describe, expect, it } from "vitest";
import { checkFeed } from "./feed-check";

const channel = (extra = "") => `<rss><channel>
<title>T</title><link>l</link><description>d</description><language>en</language>
<itunes:explicit>false</itunes:explicit><podcast:guid>g</podcast:guid>${extra}`;
const full = `<itunes:image href="x"/><itunes:category text="Sports"/><itunes:author>a</itunes:author>`;
const item = `<item><title>Ep</title><guid>1</guid><pubDate>x</pubDate>
<enclosure url="https://x/e.mp3" length="10" type="audio/mpeg"/><itunes:duration>5</itunes:duration></item>`;

describe("checkFeed", () => {
  it("passes a complete feed", () => {
    const r = checkFeed(channel(full) + item + "</channel></rss>");
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.items).toBe(1);
  });

  it("flags missing artwork and category as errors", () => {
    const r = checkFeed(channel() + item + "</channel></rss>");
    expect(r.errors.map((e) => e.message).join(" ")).toMatch(/itunes:image/);
    expect(r.errors.map((e) => e.message).join(" ")).toMatch(/itunes:category/);
    // each problem says where to fix it
    expect(r.errors.find((e) => /artwork/.test(e.message))?.fix.to).toBe("/studio/feed/tags#artwork");
    expect(r.errors.find((e) => /category/.test(e.message))?.fix.to).toBe("/studio/feed/tags#category");
  });

  it("warns, not errors, when there are no items", () => {
    const r = checkFeed(channel(full) + "</channel></rss>");
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.message)).toContain("No episodes in the feed yet.");
  });

  it("flags an item without a valid enclosure", () => {
    const bad = `<item><title>Ep</title><guid>1</guid><pubDate>x</pubDate><enclosure url="u"/></item>`;
    expect(checkFeed(channel(full) + bad + "</channel></rss>").errors.map((e) => e.message).join()).toMatch(/no valid <enclosure>/);
  });

  it("lists Podcasting 2.0 tags present", () => {
    const r = checkFeed(channel(full + `<podcast:locked owner="o">no</podcast:locked><podcast:person role="host">A</podcast:person>`) + "</channel></rss>");
    expect(r.podcast20).toEqual(["guid", "locked", "person"]);
  });
});
