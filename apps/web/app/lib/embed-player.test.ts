import { describe, expect, it } from "vitest";
import { embedHtml, embedScript, iframeHtml, parseEmbedOptions } from "./embed-player";

const view = {
  showTitle: "The Mic Drop",
  showUrl: "https://x.test/the-mic-drop",
  mode: "single" as const,
  episodes: [{ title: "Ep", number: 1, url: "https://x.test/the-mic-drop/episodes/abc/ep" }],
};
const opts = { player: "audio" as const, theme: "dark" as const, accent: "amber" as const, follow: true };

describe("parseEmbedOptions", () => {
  it("falls back to defaults for missing or hostile values", () => {
    const o = parseEmbedOptions(new URLSearchParams("player=<script>&theme=neon&accent=red"));
    expect(o).toEqual({ player: "audio", theme: "dark", accent: "amber", follow: true });
  });
  it("accepts every allowed value and follow=0", () => {
    expect(parseEmbedOptions(new URLSearchParams("player=video&theme=auto&accent=teal&follow=0"))).toEqual({
      player: "video",
      theme: "auto",
      accent: "teal",
      follow: false,
    });
  });
});

describe("embedHtml", () => {
  it("escapes titles and URLs so markup in data can't execute", () => {
    const html = embedHtml(
      { ...view, showTitle: `<img src=x onerror=alert(1)>`, episodes: [{ title: `"><script>alert(2)</script>`, number: null, url: `https://x.test/"onmouseover="alert(3)` }] },
      opts,
    );
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert(2)");
    expect(html).not.toContain(`"onmouseover="`);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
  it("renders a working player when the episode has verified audio", () => {
    const html = embedHtml({ ...view, episodes: [{ ...view.episodes[0]!, id: "abc", audioUrl: "https://x.test/the-mic-drop/media/abc/episode.mp3", durationS: 125 }] }, opts);
    expect(html).toMatch(/<audio id="a" preload="none">/);
    expect(html).not.toContain("autoplay"); // never starts by itself
    expect(html).toContain('aria-label="Back 15 seconds"');
    expect(html).toContain('aria-label="Forward 30 seconds"');
    expect(html).toContain("0:00 / 2:05");
    expect(html).toContain("https://x.test/the-mic-drop/media/abc/episode.mp3");
    expect(html).not.toContain("Audio isn't available");
  });
  it("says so, with no audio element, when nothing is playable", () => {
    const html = embedHtml(view, opts);
    expect(html).not.toMatch(/<(audio|video)[\s>]/);
    expect(html).toContain("Audio isn't available");
  });
  it("can't be broken out of by markup in titles inside the JSON data block", () => {
    const html = embedHtml({ ...view, episodes: [{ ...view.episodes[0]!, title: `</script><script>alert(1)</script>`, audioUrl: "https://x.test/a.mp3" }] }, opts);
    expect(html).not.toContain("</script><script>alert(1)");
    const json = html.match(/<script type="application\/json" id="d">(.*?)<\/script>/)![1]!;
    expect(JSON.parse(json).eps[0].t).toBe(`</script><script>alert(1)</script>`);
  });
  it("playlist mode lists episodes as buttons and disables ones without audio", () => {
    const html = embedHtml(
      { ...view, mode: "playlist", episodes: [{ title: "A", number: 1, url: "u", audioUrl: "m" }, { title: "B", number: 2, url: "u2", audioUrl: null }] },
      opts,
    );
    expect(html.match(/<li data-i/g)).toHaveLength(2);
    expect(html).toMatch(/<li data-i="1"><button type="button" disabled>/);
  });
  it("shows artwork when the show has some", () => {
    expect(embedHtml({ ...view, artworkUrl: "https://x.test/art.png" }, opts)).toContain('src="https://x.test/art.png"');
    expect(embedHtml(view, opts)).not.toContain("<img");
  });
  it("uses the README tokens and follows the OS only for theme=auto", () => {
    expect(embedHtml(view, opts)).toContain("--bg:#151517");
    expect(embedHtml(view, { ...opts, theme: "light" })).toContain("--bg:#ffffff");
    expect(embedHtml(view, opts)).not.toContain("prefers-color-scheme");
    expect(embedHtml(view, { ...opts, theme: "auto" })).toContain("prefers-color-scheme:light");
  });
  it("hides Follow when follow is off and shows a video stage for the video player", () => {
    expect(embedHtml(view, { ...opts, follow: false })).not.toContain('class="follow"');
    expect(embedHtml(view, { ...opts, player: "video" })).toContain("Video not available");
  });
  it("lists every episode in playlist mode", () => {
    const html = embedHtml(
      { ...view, mode: "playlist", episodes: [1, 2, 3].map((n) => ({ title: `E${n}`, number: n, url: `u${n}` })) },
      opts,
    );
    expect(html.match(/<li data-i/g)).toHaveLength(3);
  });
});

describe("iframeHtml / embedScript", () => {
  it("escapes & in the src attribute", () => {
    expect(iframeHtml("https://x.test/e?a=1&b=2", opts)).toContain('src="https://x.test/e?a=1&amp;b=2"');
  });
  it("uses 360px for video and 152px for audio", () => {
    expect(iframeHtml("u", { ...opts, player: "video" })).toContain('height="360"');
    expect(iframeHtml("u", opts)).toContain('height="152"');
  });
  it("embed.js only trusts messages from its own iframe", () => {
    expect(embedScript()).toContain("e.source!==f.contentWindow");
  });
  it("embed.js re-fires only the known player events on the host element", () => {
    expect(embedScript()).toContain("podstudio:(play|pause|ended|timeupdate)");
  });
});
