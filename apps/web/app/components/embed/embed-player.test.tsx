import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EmbedOptions, EmbedView } from "~/lib/embed-player";
import { EmbedPlayer } from "./embed-player";

const view: EmbedView = {
  showTitle: "The Mic Drop",
  showUrl: "https://x.test/the-mic-drop",
  mode: "single",
  episodes: [{ title: "Ep", number: 1, url: "https://x.test/the-mic-drop/episodes/abc/ep" }],
};
const opts: EmbedOptions = { player: "audio", theme: "dark", accent: "amber", follow: true };
const render = (v: EmbedView, o = opts) => renderToString(<EmbedPlayer view={v} options={o} />);

describe("EmbedPlayer (server render)", () => {
  it("escapes titles and URLs so markup in data can't execute", () => {
    const html = render({ ...view, showTitle: `<img src=x onerror=alert(1)>`, episodes: [{ title: `"><script>alert(2)</script>`, number: null, url: `https://x.test/"onmouseover="alert(3)` }] });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert(2)");
    expect(html).not.toContain(`"onmouseover="`);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
  it("renders the audiocn player with −15 / +30, seek, speed and the known duration", () => {
    const html = render({ ...view, episodes: [{ ...view.episodes[0]!, id: "abc", audioUrl: "https://x.test/a.mp3", durationS: 125 }] });
    expect(html).toContain('data-slot="audio-player"');
    expect(html).toContain('data-slot="audio-player-play"');
    expect(html).toContain('aria-label="Back 15 seconds"');
    expect(html).toContain('aria-label="Forward 30 seconds"');
    expect(html).toContain('aria-label="Playback speed"');
    expect(html).toContain("2:05");
    expect(html).not.toContain("autoplay"); // never starts by itself
    expect(html).not.toContain("Audio isn&#x27;t available");
  });
  it("says so, with no player, when nothing is playable", () => {
    const html = render(view);
    expect(html).not.toContain('data-slot="audio-player"');
    expect(html).toContain("Audio isn&#x27;t available");
  });
  it("playlist mode lists episodes in the audiocn TrackList and disables ones without audio", () => {
    const html = render({ ...view, mode: "playlist", episodes: [{ title: "A", number: 1, url: "u", audioUrl: "m" }, { title: "B", number: 2, url: "u2", audioUrl: null }, { title: "C", number: 3, url: "u3", audioUrl: "m3" }] });
    expect(html.match(/data-slot="track-list-item"/g)).toHaveLength(3);
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(1);
    expect(html).toContain('aria-current="true"');
  });
  it("shows artwork when the show has some", () => {
    expect(render({ ...view, artworkUrl: "https://x.test/art.png" })).toContain("art.png");
    expect(render(view)).not.toContain("<img");
  });
  it("hides Follow when follow is off and shows a video stage for the video player", () => {
    expect(render(view, { ...opts, follow: false })).not.toContain('data-testid="embed-follow"');
    expect(render(view, { ...opts, player: "video" })).toContain("Video not available");
  });
});
