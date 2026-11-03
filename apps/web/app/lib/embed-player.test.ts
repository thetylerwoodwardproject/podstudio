import { describe, expect, it } from "vitest";
import { embedScript, embedThemeCss, iframeHtml, parseEmbedOptions } from "./embed-player";

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
    expect(o).toEqual({ player: "audio", theme: "dark", accent: "gold", follow: true });
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

describe("embed accents", () => {
  it("accepts the six palette accents and still the old amber/teal/ink in pasted snippets", () => {
    for (const a of ["black", "gold", "cyan", "lime", "coral", "lavender", "amber", "teal", "ink"]) expect(parseEmbedOptions(new URLSearchParams(`accent=${a}`)).accent).toBe(a);
  });
  it("shows black as bone on dark and puts readable text on bright accents", () => {
    expect(embedThemeCss({ ...opts, accent: "black" })).toContain("--primary:#ecebe6");
    expect(embedThemeCss({ ...opts, accent: "lime" })).toContain("--primary-foreground:#111113");
  });
});

describe("embedThemeCss", () => {
  it("uses the README tokens, maps the accent onto --primary, and follows the OS only for theme=auto", () => {
    expect(embedThemeCss(opts)).toContain("--bg:#151517");
    expect(embedThemeCss(opts)).toContain("--primary:#e8b04a");
    expect(embedThemeCss({ ...opts, theme: "light" })).toContain("--bg:#ffffff");
    expect(embedThemeCss(opts)).not.toContain("prefers-color-scheme");
    expect(embedThemeCss({ ...opts, theme: "auto" })).toContain("prefers-color-scheme:light");
  });
  it("only carries the color-bar stage for the video player", () => {
    expect(embedThemeCss(opts)).not.toContain(".emb-stage");
    expect(embedThemeCss({ ...opts, player: "video" })).toContain(".emb-stage");
  });
});

describe("iframeHtml / embedScript", () => {
  it("escapes & in the src attribute", () => {
    expect(iframeHtml("https://x.test/e?a=1&b=2", opts)).toContain('src="https://x.test/e?a=1&amp;b=2"');
  });
  it("uses 400px for video and 196px for audio (starting heights; the player resizes itself)", () => {
    expect(iframeHtml("u", { ...opts, player: "video" })).toContain('height="400"');
    expect(iframeHtml("u", opts)).toContain('height="196"');
  });
  it("embed.js only trusts messages from its own iframe", () => {
    expect(embedScript()).toContain("e.source!==f.contentWindow");
  });
  it("embed.js re-fires only the known player events on the host element", () => {
    expect(embedScript()).toContain("podstudio:(play|pause|ended|timeupdate)");
  });
});
