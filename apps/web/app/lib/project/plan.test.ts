import { describe, expect, it } from "vitest";
import { createProject, cutRange, setClipLevels, updateTrack, addTrack, type ProjectDoc } from "./document";
import { WINDOW_SAMPLES, audibleTracks, clipGainAt, gainBreakpoints, planPieces } from "./plan";

const R = 48_000;
const base = () => createProject({ sampleRate: R, source: { id: "s", assetId: "a", label: "x", totalSamples: 60 * R } });
const must = (r: any): ProjectDoc => {
  if (!r.ok) throw new Error(r.error);
  return r.doc;
};

describe("planPieces", () => {
  it("never straddles a source window and covers the range exactly", () => {
    const d = base();
    const pieces = planPieces(d, 5 * R, 25 * R);
    expect(pieces.reduce((n, p) => n + p.length, 0)).toBe(20 * R);
    for (const p of pieces) expect(Math.floor(p.srcStart / WINDOW_SAMPLES)).toBe(Math.floor((p.srcStart + p.length - 1) / WINDOW_SAMPLES));
    expect(pieces[0]).toMatchObject({ start: 5 * R, srcStart: 5 * R });
  });
  it("follows a ripple cut: timeline time after the cut maps to later source audio", () => {
    const d = must(cutRange(base(), 10 * R, 20 * R, { ripple: true }));
    const at = planPieces(d, 10 * R, 11 * R);
    expect(at[0]).toMatchObject({ start: 10 * R, srcStart: 20 * R });
  });
  it("skips muted tracks and honours solo", () => {
    let d = addTrack(base(), "guest");
    const [h, g] = d.tracks;
    expect(audibleTracks(d).size).toBe(2);
    d = must(updateTrack(d, h!.id, { muted: true }));
    expect([...audibleTracks(d)]).toEqual([g!.id]);
    d = must(updateTrack(d, h!.id, { muted: false, solo: true }));
    expect([...audibleTracks(d)]).toEqual([h!.id]);
    expect(planPieces(d, 0, R).every((p) => p.trackId === h!.id)).toBe(true);
  });
});

describe("gain", () => {
  it("applies clip gain and linear fades; breakpoints reproduce the ramps", () => {
    const d = base();
    const id = d.clips[0]!.id;
    const e = must(setClipLevels(d, id, { gainDb: -6, fadeIn: R, fadeOut: 2 * R }));
    const c = e.clips[0]!;
    expect(clipGainAt(c, 0)).toBe(0);
    expect(clipGainAt(c, R / 2)).toBeCloseTo(0.5 * 10 ** (-6 / 20), 6);
    expect(clipGainAt(c, 30 * R)).toBeCloseTo(10 ** (-6 / 20), 6);
    expect(clipGainAt(c, 60 * R)).toBe(0);
    const bp = gainBreakpoints(c, { clipId: id, trackId: c.trackId, sourceId: "s", start: 0, srcStart: 0, length: 60 * R });
    expect(bp.map((b) => b[0])).toEqual([0, R, 58 * R, 60 * R]);
  });
});
