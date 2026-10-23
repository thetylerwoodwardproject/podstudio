import { describe, expect, it } from "vitest";
import { itemXml, zonedToUtcMs } from "./item-xml";

const base = {
  title: "T",
  guid: "838cc347-69ef-4f8c-8a05-7f5526ae9522",
  guidIsPermalink: null,
  pubDate: null,
  season: null,
  number: null,
  durationS: null,
  explicit: false,
  people: [],
};

describe("zonedToUtcMs", () => {
  it("handles standard time (CST, UTC-6)", () => {
    expect(new Date(zonedToUtcMs("2027-01-15T09:30", "America/Chicago")!).toISOString()).toBe("2027-01-15T15:30:00.000Z");
  });
  it("handles daylight time (CDT, UTC-5)", () => {
    expect(new Date(zonedToUtcMs("2027-07-15T09:30", "America/Chicago")!).toISOString()).toBe("2027-07-15T14:30:00.000Z");
  });
  it("handles zones east of UTC and UTC itself", () => {
    expect(new Date(zonedToUtcMs("2027-01-15T09:30", "Asia/Kolkata")!).toISOString()).toBe("2027-01-15T04:00:00.000Z");
    expect(new Date(zonedToUtcMs("2027-01-15T09:30", "UTC")!).toISOString()).toBe("2027-01-15T09:30:00.000Z");
  });
  it("is correct on either side of a DST change", () => {
    // US spring-forward 2027-03-14 02:00 local
    expect(new Date(zonedToUtcMs("2027-03-14T01:30", "America/Chicago")!).toISOString()).toBe("2027-03-14T07:30:00.000Z");
    expect(new Date(zonedToUtcMs("2027-03-14T03:30", "America/Chicago")!).toISOString()).toBe("2027-03-14T08:30:00.000Z");
  });
  it("returns null for malformed input, impossible dates and unknown zones", () => {
    expect(zonedToUtcMs("tomorrow", "UTC")).toBeNull();
    expect(zonedToUtcMs("2027-02-31T10:00", "UTC")).toBeNull();
    expect(zonedToUtcMs("2027-01-15T09:30", "Not/AZone")).toBeNull();
  });
});

describe("itemXml", () => {
  it("writes the guid verbatim and omits isPermaLink when the stored flag is null", () => {
    expect(itemXml(base)).toContain(`<guid>${base.guid}</guid>`);
  });
  it("writes isPermaLink only when stored (0 -> false, 1 -> true)", () => {
    expect(itemXml({ ...base, guidIsPermalink: 0 })).toContain('<guid isPermaLink="false">');
    expect(itemXml({ ...base, guidIsPermalink: 1 })).toContain('<guid isPermaLink="true">');
  });
  it("escapes XML in title, guid and people", () => {
    const x = itemXml({ ...base, title: `A & B <c> "d"`, people: [{ name: "Tom & Jerry", role: 'ho"st' }] });
    expect(x).toContain("<title>A &amp; B &lt;c&gt; &quot;d&quot;</title>");
    expect(x).toContain('<podcast:person role="ho&quot;st">Tom &amp; Jerry</podcast:person>');
  });
  it("omits pubDate when unscheduled and formats it as GMT when set", () => {
    expect(itemXml(base)).not.toContain("pubDate");
    expect(itemXml({ ...base, pubDate: Date.UTC(2027, 6, 15, 14, 30) })).toContain("<pubDate>Thu, 15 Jul 2027 14:30:00 GMT</pubDate>");
  });
  it("omits a person's role attribute when unset instead of guessing", () => {
    expect(itemXml({ ...base, people: [{ name: "X", role: null }] })).toContain("<podcast:person>X</podcast:person>");
  });
  it("never claims an enclosure it doesn't have", () => {
    expect(itemXml(base)).not.toMatch(/<enclosure/);
  });
});
