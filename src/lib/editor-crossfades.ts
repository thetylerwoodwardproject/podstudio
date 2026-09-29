import type { EditorClip, EditorCrossfade, EditorProjectV1, EditorTrack } from './editor-project.ts';
const end = (c: EditorClip) => c.timelineStart + c.sourceEnd - c.sourceStart;
const bounds = (track: EditorTrack, ids: string[]) => {
  const clips = track.clips.filter((c) => ids.includes(c.id));
  return clips.length ? [Math.min(...clips.map((c) => c.timelineStart)), Math.max(...clips.map(end))] : null;
};
export function crossfadeSpan(track: EditorTrack, fade: EditorCrossfade): [number, number] | null {
  const a = bounds(track, fade.from), b = bounds(track, fade.to);
  return a && b && a[0] < b[0] && a[1] < b[1] && b[0] < a[1] ? [b[0], a[1]] : null;
}
export function crossfadeGain(track: EditorTrack, fades: EditorCrossfade[], clipId: string, time: number): number {
  let gain = 1;
  for (const fade of fades) {
    const outgoing = fade.from.includes(clipId), incoming = fade.to.includes(clipId);
    if (!outgoing && !incoming) continue;
    const span = crossfadeSpan(track, fade); if (!span) continue;
    const progress = Math.max(0, Math.min(1, (time - span[0]) / (span[1] - span[0])));
    gain *= outgoing ? Math.cos(progress * Math.PI / 2) : Math.sin(progress * Math.PI / 2);
  }
  return gain;
}
/** Keep split fragments on the same envelope; split itself must not change sound. */
export function remapCrossfades(before: EditorProjectV1, after: EditorProjectV1, replacements = new Map<string, string[]>()) {
  after.crossfades = (before.crossfades ?? []).flatMap((fade) => {
    const track = after.tracks.find((t) => t.id === fade.trackId); if (!track) return [];
    const remap = (ids: string[]) => [...new Set(ids.flatMap((id) => replacements.get(id) ?? [id]))].filter((id) => track.clips.some((c) => c.id === id));
    const next = { ...fade, from: remap(fade.from), to: remap(fade.to) };
    return next.from.length && next.to.length && crossfadeSpan(track, next) ? [next] : [];
  });
}
export function refreshCrossfades(project: EditorProjectV1, changed: Set<string>) {
  project.crossfades = (project.crossfades ?? []).filter((f) => ![...f.from, ...f.to].some((id) => changed.has(id)));
  const added = new Set<string>();
  for (const track of project.tracks) for (const a of track.clips.filter((c) => changed.has(c.id))) for (const b of track.clips) {
    if (a.id === b.id) continue;
    const [outgoing, incoming] = a.timelineStart < b.timelineStart ? [a, b] : [b, a];
    const key = JSON.stringify([track.id, outgoing.id, incoming.id]); if (added.has(key)) continue;
    const fade = { trackId: track.id, from: [outgoing.id], to: [incoming.id] };
    const span = crossfadeSpan(track, fade);
    if (span && !track.clips.some((c) => c.id !== a.id && c.id !== b.id && c.timelineStart < span[1] && end(c) > span[0])) { project.crossfades.push(fade); added.add(key); }
  }
}
function invalidOverlaps(project: EditorProjectV1): Set<string> {
  const invalid = new Set<string>();
  for (const track of project.tracks) {
    const clips = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart);
    const key = (ids: string[]) => JSON.stringify([track.id, ...ids.sort()]);
    for (let i = 0; i < clips.length; i++) for (let j = i + 1; j < clips.length && clips[j].timelineStart < end(clips[i]); j++) {
      const a = clips[i], b = clips[j];
      if (end(a) >= end(b) || a.timelineStart === b.timelineStart) invalid.add(key([a.id, b.id]));
      const overlapEnd = Math.min(end(a), end(b));
      for (let k = j + 1; k < clips.length && clips[k].timelineStart < overlapEnd; k++) invalid.add(key([a.id, b.id, clips[k].id]));
    }
  }
  return invalid;
}
/** Overlap topology changes only where two linear clip edges coincide. */
export function clampOverlapEdit(original: EditorProjectV1, requested: number, minimum: number, maximum: number, apply: (delta: number) => EditorProjectV1): EditorProjectV1 {
  const grandfathered = invalidOverlaps(original);
  const valid = (p: EditorProjectV1) => [...invalidOverlaps(p)].every((key) => grandfathered.has(key));
  const desired = Math.max(minimum, Math.min(maximum, requested));
  const proposed = apply(desired);
  if (valid(proposed)) return proposed;
  const atZero = apply(0), atOne = apply(1);
  const candidates = [0, minimum, maximum];
  for (const track of atZero.tracks) {
    const oneById = new Map(atOne.tracks.find((t) => t.id === track.id)!.clips.map((c) => [c.id, c]));
    const edges = track.clips.flatMap((c) => {
      const one = oneById.get(c.id)!;
      return [{ clip: c.id, at: c.timelineStart, slope: one.timelineStart - c.timelineStart }, { clip: c.id, at: end(c), slope: end(one) - end(c) }];
    });
    for (const a of edges.filter((e) => Math.abs(e.slope) > 1e-9)) for (const b of edges) if (a.clip !== b.clip && Math.abs(a.slope - b.slope) > 1e-9) {
      const delta = (b.at - a.at) / (a.slope - b.slope);
      candidates.push(delta, delta - .001, delta + .001);
    }
  }
  for (const delta of candidates.filter((n) => Number.isFinite(n) && n >= minimum && n <= maximum).sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired))) {
    const p = apply(delta); if (valid(p)) return p;
  }
  return structuredClone(original);
}
