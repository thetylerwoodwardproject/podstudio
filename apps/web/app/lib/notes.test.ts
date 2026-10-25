import { describe, expect, it } from "vitest";
import { parseInline, parseNotes } from "./notes";

describe("parseInline", () => {
  it("finds links, trims trailing punctuation, keeps the rest as text", () => {
    expect(parseInline("See https://example.com/a?b=1, then go.")).toEqual([
      { t: "text", v: "See " },
      { t: "link", href: "https://example.com/a?b=1", v: "https://example.com/a?b=1" },
      { t: "text", v: ", then go." },
    ]);
  });
  it("finds m:ss and h:mm:ss timestamps", () => {
    expect(parseInline("12:34 Intro and 1:02:03 outro")).toEqual([
      { t: "time", seconds: 754, v: "12:34" },
      { t: "text", v: " Intro and " },
      { t: "time", seconds: 3723, v: "1:02:03" },
      { t: "text", v: " outro" },
    ]);
  });
  it("ignores things that merely look like times", () => {
    expect(parseInline("ratio 3:99 and 7:61 and version 1.2:3")).toEqual([{ t: "text", v: "ratio 3:99 and 7:61 and version 1.2:3" }]);
  });
  it("never links non-http schemes or tags", () => {
    const j = JSON.stringify(parseInline(`javascript:alert(1) <script>alert(2)</script> ftp://x data:text/html,hi`));
    expect(j).not.toContain('"t":"link"');
  });
  it("a timestamp inside a URL stays part of the link", () => {
    const r = parseInline("https://youtu.be/abc?t=1:30");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ t: "link" });
  });
});

describe("parseNotes", () => {
  it("splits paragraphs, keeps single newlines, and detects bullet lists", () => {
    const b = parseNotes("Intro line\nsecond line\n\n- one\n- two https://a.test\n\nEnd");
    expect(b.map((x) => x.type)).toEqual(["p", "ul", "p"]);
    expect((b[1] as any).items).toHaveLength(2);
    expect(JSON.stringify(b[0])).toContain("\\n");
  });
  it("a lead-in line followed by bullets becomes a paragraph then a list", () => {
    const b = parseNotes("Chapters:\n- 0:30 Cold open\n- 1:05 Rule change");
    expect(b.map((x) => x.type)).toEqual(["p", "ul"]);
    expect((b[1] as any).items).toHaveLength(2);
  });
  it("empty / whitespace gives no blocks", () => {
    expect(parseNotes("  \n\n \n")).toEqual([]);
  });
});
