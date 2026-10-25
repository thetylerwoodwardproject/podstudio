import { describe, expect, it } from "vitest";
import { cleanForStorage, htmlToText, sanitizeFeedHtml, sanitizeRichHtml, toHtml } from "./rich-text.server";

describe("toHtml", () => {
  it("turns plain notes into paragraphs, lists and links", () => {
    const h = toHtml("Hello & welcome\nsecond line\n\n- one\n- see https://example.com/a.\n\nEnd < 3");
    expect(h).toContain("<p>Hello &amp; welcome<br>second line</p>");
    expect(h).toContain("<ul><li>one</li><li>see <a href=\"https://example.com/a\">https://example.com/a</a>.</li></ul>");
    expect(h).toContain("End &lt; 3");
  });
  it("leaves HTML alone", () => expect(toHtml("<p>x</p>")).toBe("<p>x</p>"));
  it("empty → empty", () => expect(toHtml("  ")).toBe(""));
});

describe("sanitizeRichHtml", () => {
  it("keeps rich structure", () => {
    const h = sanitizeRichHtml('<h2>Title</h2><p>a <strong>b</strong> <em>c</em></p><ul><li>x</li></ul><blockquote>q</blockquote><table><tr><td colspan="2">t</td></tr></table><pre><code>x</code></pre><hr>');
    for (const t of ["<h2>", "<strong>", "<ul>", "<blockquote>", "<table>", 'colspan="2"', "<pre>", "<hr />"]) expect(h).toContain(t);
  });
  it("removes scripts, styles, handlers, forms and javascript: URLs", () => {
    const h = sanitizeRichHtml(
      '<p onclick="x()">hi</p><script>alert(1)</script><style>p{}</style><form action="/x"><input name="a"></form><a href="javascript:alert(1)">bad</a><img src="x" onerror="alert(2)"><svg onload="alert(3)"></svg><a href="data:text/html,hi">d</a>',
    );
    expect(h).not.toMatch(/script|onclick|onerror|onload|<style|<form|<input|<svg|javascript:|data:/i);
    expect(h).toContain("hi");
  });
  it("links open in a new tab with safe rel", () => {
    expect(sanitizeRichHtml('<a href="https://a.test/x">l</a>')).toBe('<a href="https://a.test/x" target="_blank" rel="noopener noreferrer nofollow ugc">l</a>');
  });
  it("images must be https; h1 becomes h2", () => {
    expect(sanitizeRichHtml('<img src="http://a.test/i.png">')).not.toContain("<img");
    expect(sanitizeRichHtml('<img src="https://a.test/i.png" alt="x">')).toContain('loading="lazy"');
    expect(sanitizeRichHtml("<h1>Big</h1>")).toBe("<h2>Big</h2>");
  });
  it("allows iframes only from the embed allowlist, https only", () => {
    expect(sanitizeRichHtml('<iframe src="https://www.youtube.com/embed/abc"></iframe>')).toContain("youtube.com/embed/abc");
    expect(sanitizeRichHtml('<iframe src="https://evil.test/x"></iframe>')).not.toContain("iframe");
    expect(sanitizeRichHtml('<iframe src="http://www.youtube.com/embed/abc"></iframe>')).not.toContain("iframe");
    expect(sanitizeRichHtml('<iframe srcdoc="<script>1</script>" src="https://open.spotify.com/embed/x"></iframe>')).not.toContain("srcdoc");
  });
});

describe("feed + text", () => {
  it("feed HTML is the small set: no images, iframes, tables or attributes beyond href", () => {
    const h = sanitizeFeedHtml('<p class="x">a <a href="https://a.test" target="_blank">l</a></p><img src="https://a.test/i.png"><table><tr><td>t</td></tr></table><iframe src="https://www.youtube.com/embed/a"></iframe>');
    expect(h).toBe('<p>a <a href="https://a.test">l</a></p>t');
  });
  it("htmlToText collapses structure to one line and decodes entities", () => {
    expect(htmlToText("<p>Fish &amp; chips</p><ul><li>one</li><li>two</li></ul><p>End</p>")).toBe("Fish & chips one two End");
    expect(htmlToText("plain\n\ntext")).toBe("plain text");
    expect(htmlToText(null)).toBe("");
  });
  it("cleanForStorage drops empty editor output but keeps media-only content", () => {
    expect(cleanForStorage("<p></p>")).toBeNull();
    expect(cleanForStorage("<p> <br> </p>")).toBeNull();
    expect(cleanForStorage("<p>x</p>")).toBe("<p>x</p>");
    expect(cleanForStorage('<img src="https://a.test/i.png">')).toContain("<img");
  });
});
