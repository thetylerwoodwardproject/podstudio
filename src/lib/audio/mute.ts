/*
 * Muting a stretch of a track in the edit (a cough): silence with a short
 * fade at each edge, inside the stretch, so there's no click.
 */

export const MUTE_FADE = 0.01;

/**
 * Silence frames [muteFrom, muteTo) of `x` (interleaved, `channels` wide,
 * starting at frame `from`), fading over `fade` frames at both edges. In place.
 */
export function applyMute(x: Float32Array, channels: number, from: number, muteFrom: number, muteTo: number, fade: number) {
  const frames = Math.floor(x.length / channels);
  const a = Math.max(0, muteFrom - from);
  const b = Math.min(frames, muteTo - from);
  for (let i = a; i < b; i++) {
    const f = from + i;
    const edge = Math.min(f - muteFrom, muteTo - 1 - f);
    const g = fade > 0 ? Math.max(0, 1 - edge / fade) : 0;
    for (let c = 0; c < channels; c++) x[i * channels + c] *= g;
  }
  return x;
}

/** Split [a, b) around the muted stretches: which pieces are muted. */
export function splitByMutes(a: number, b: number, muted: [number, number][]): { a: number; b: number; muted: boolean }[] {
  const out: { a: number; b: number; muted: boolean }[] = [];
  let at = a;
  for (const [ma, mb] of [...muted].sort((x, y) => x[0] - y[0])) {
    const s = Math.max(at, ma);
    const e = Math.min(b, mb);
    if (e <= s) continue;
    if (s > at) out.push({ a: at, b: s, muted: false });
    out.push({ a: s, b: e, muted: true });
    at = e;
  }
  if (at < b) out.push({ a: at, b, muted: false });
  return out;
}
