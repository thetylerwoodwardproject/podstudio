import { embedScript } from "~/lib/embed-player";

// `/embed.js` — the Script tab's loader (README 27): turns `<div data-podstudio=
// "show/target" data-player data-theme ...>` into the same iframe and resizes it
// from the iframe's postMessage. It does not forward play/pause/timeupdate
// events or push prefers-color-scheme changes — there's no audio, and theme=auto
// is already handled by the iframe's own media query.
export async function loader() {
  return new Response(embedScript(), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
