// Our public image URLs end in `{sha12}.{png|jpg}`; `{sha12}-s.{ext}` is the same
// image as a small thumbnail (made on first request, see image-assets.server.ts).
// Pages use thumbnails wherever the picture is small (lists, grids, the sticky
// player, avatars) so a grid of covers doesn't pull down ten 3000 px files.
export function thumbUrl<T extends string | null | undefined>(url: T): T {
  if (!url) return url;
  return url.replace(/(\/[0-9a-f]{12})(\.(?:png|jpg))$/, "$1-s$2") as T;
}

/** `abc123abc123-s.jpg` → { name: "abc123abc123.jpg", thumb: true }; null when it isn't one of ours. */
export function parseImageFile(file: string | undefined): { name: string; thumb: boolean } | null {
  const m = /^([0-9a-f]{12})(-s)?\.(png|jpg)$/.exec(file ?? "");
  return m ? { name: `${m[1]}.${m[3]}`, thumb: !!m[2] } : null;
}
