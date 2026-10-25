// Reads just enough of a PNG or JPEG header to learn its type and pixel size, so
// uploaded show artwork can be checked against Apple's rules (JPEG/PNG, square,
// 1400–3000 px) without an image library. Returns null for anything else — the
// magic bytes decide the type, never the filename.
export interface ImageInfo {
  type: "png" | "jpeg";
  width: number;
  height: number;
}

export function imageInfo(buf: Uint8Array): ImageInfo | null {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // PNG: 8-byte signature, then the IHDR chunk (width/height at bytes 16–23).
  if (buf.length >= 24 && v.getUint32(0) === 0x89504e47 && v.getUint32(4) === 0x0d0a1a0a && v.getUint32(12) === 0x49484452) {
    return { type: "png", width: v.getUint32(16), height: v.getUint32(20) };
  }
  // JPEG: walk the marker segments to the first start-of-frame (SOFn).
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1]!;
      if (marker === 0xff) {
        i++; // fill byte
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2; // standalone markers carry no length
        continue;
      }
      const len = v.getUint16(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { type: "jpeg", height: v.getUint16(i + 5), width: v.getUint16(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

export const ARTWORK_MIN = 1400;
export const ARTWORK_MAX = 3000;
export const ARTWORK_MAX_BYTES = 5 * 1024 * 1024;

/** Apple Podcasts' artwork rules. Returns an error message, or null when acceptable. */
export function artworkProblem(info: ImageInfo | null): string | null {
  if (!info) return "That file isn't a PNG or JPEG image.";
  if (info.width !== info.height) return `Artwork must be square — this one is ${info.width}×${info.height}.`;
  if (info.width < ARTWORK_MIN || info.width > ARTWORK_MAX) {
    return `Artwork must be between ${ARTWORK_MIN}×${ARTWORK_MIN} and ${ARTWORK_MAX}×${ARTWORK_MAX} pixels — this one is ${info.width}×${info.height}.`;
  }
  return null;
}

export const AVATAR_MIN = 200;
export const AVATAR_MAX = 4000;

/** Headshot rules: PNG/JPEG, at least 200 px on each side, at most 4000. Any aspect (shown cropped to a circle/square). */
export function avatarProblem(info: ImageInfo | null): string | null {
  if (!info) return "That file isn't a PNG or JPEG image.";
  if (info.width < AVATAR_MIN || info.height < AVATAR_MIN) {
    return `The photo is too small (${info.width}×${info.height}) — use at least ${AVATAR_MIN}×${AVATAR_MIN} pixels.`;
  }
  if (info.width > AVATAR_MAX || info.height > AVATAR_MAX) {
    return `The photo is too large (${info.width}×${info.height}) — use at most ${AVATAR_MAX}×${AVATAR_MAX} pixels.`;
  }
  return null;
}

export const BANNER_MIN_W = 1600;
export const BANNER_MIN_H = 400;
export const BANNER_MAX_W = 6000;

/** Header image rules: PNG/JPEG, wide (at least 1600×400, at least 2.5:1, at most 6000 px across). It is cropped to fit, so only the centre is guaranteed to show. */
export function bannerProblem(info: ImageInfo | null): string | null {
  if (!info) return "That file isn't a PNG or JPEG image.";
  if (info.width < BANNER_MIN_W || info.height < BANNER_MIN_H) {
    return `The image is too small (${info.width}×${info.height}) — use at least ${BANNER_MIN_W}×${BANNER_MIN_H} pixels.`;
  }
  if (info.width > BANNER_MAX_W) return `The image is too wide (${info.width} px) — use at most ${BANNER_MAX_W} pixels across.`;
  if (info.width / info.height < 2.5) {
    return `The image isn't wide enough (${info.width}×${info.height}) — a header should be at least 2.5 times wider than tall, e.g. 3200×800.`;
  }
  return null;
}
