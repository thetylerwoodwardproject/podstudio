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
  it("never claims playback: no <audio>/<video> element, and says audio is unavailable", () => {
    const html = embedHtml(view, opts);
    expect(html).not.toMatch(/<(audio|video)[\s>]/);
    expect(html).toContain("Audio isn't available yet");
  });
  it("uses the README tokens and follows the OS only for theme=auto", () => {
    expect(embedHtml(view, opts)).toContain("--bg:#151517");
    expect(embedHtml(view, { ...opts, theme: "light" })).toContain("--bg:#ffffff");
    expect(embedHtml(view, opts)).not.toContain("prefers-color-scheme");
    expect(embedHtml(view, { ...opts, theme: "auto" })).toContain("prefers-color-scheme:light");
  });
  it("hides Follow when follow is off and shows a video stage for the video player", () => {
    expect(embedHtml(view, { ...opts, follow: false })).not.toContain('class="follow"');
    expect(embedHtml(view, { ...opts, player: "video" })).toContain("Video isn't available yet");
  });
  it("lists every episode in playlist mode", () => {
    const html = embedHtml(
      { ...view, mode: "playlist", episodes: [1, 2, 3].map((n) => ({ title: `E${n}`, number: n, url: `u${n}` })) },
      opts,
    );
    expect(html.match(/<li>/g)).toHaveLength(3);
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
    expect(embedScript()).toContain("e.source===f.contentWindow");
  });
});
