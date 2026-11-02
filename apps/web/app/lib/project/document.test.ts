import { describe, expect, it } from "vitest";
import {
  addChapter,
  addSourceClip,
  freeSpot,
  addTrack,
  annotationPositions,
  clipsOnTrack,
  createProject,
  cutRange,
  cutRanges,
  editedToSource,
  moveClip,
  parseProject,
  projectLength,
  setClipLevels,
  sourceToEdited,
  splitAt,
  splitClip,
  trimClip,
  updateTrack,
  removeTrack,
  removeSource,
  withCrossfades,
  crossfades,
  layoutProblem,
  type ProjectDoc,
} from "./document";
import { canRedo, canUndo, commit, createHistory, redo, undo } from "./history";

const RATE = 48_000;
const base = (retakes: number[] = []): ProjectDoc =>
  createProject({ sampleRate: RATE, source: { id: "s1", assetId: "a1", label: "Take 1", totalSamples: 10 * RATE, retakes } });
const must = (r: { ok: boolean; doc?: ProjectDoc; error?: string }): ProjectDoc => {
  if (!r.ok) throw new Error(r.error);
  return r.doc!;
};
/** Two linked tracks (host + guest) from the same-length takes, as a remote session would give. */
const twoTracks = (): ProjectDoc => {
  const d = base();
  const g = addTrack(
    { ...d, sources: [...d.sources, { id: "s2", assetId: "a2", label: "Guest", totalSamples: 10 * RATE }] },
    "guest",
  );
  const gid = g.tracks[1]!.id;
  return { ...g, clips: [...g.clips, { id: "g1", trackId: gid, sourceId: "s2", srcStart: 0, length: 10 * RATE, start: 0, gainDb: 0, fadeIn: 0, fadeOut: 0 }] };
};

describe("createProject", () => {
  it("makes one host track with the whole recording and retakes as annotations", () => {
    const d = base([3 * RATE, RATE, 99 * RATE, -5]);
    expect(d.tracks).toHaveLength(1);
    expect(d.clips).toMatchObject([{ srcStart: 0, start: 0, length: 10 * RATE }]);
    expect(d.annotations.map((a) => a.sample)).toEqual([RATE, 3 * RATE]); // out of range dropped, sorted
    expect(d.annotations.map((a) => a.label)).toEqual(["Retake 1", "Retake 2"]);
  });
});

describe("split / trim / move", () => {
  it("splits so both halves keep the same source audio in the same place", () => {
    const d = must(splitAt(base(), 4 * RATE));
    const [a, b] = clipsOnTrack(d, d.tracks[0]!.id);
    expect(a).toMatchObject({ start: 0, srcStart: 0, length: 4 * RATE });
    expect(b).toMatchObject({ start: 4 * RATE, srcStart: 4 * RATE, length: 6 * RATE });
    expect(projectLength(d)).toBe(10 * RATE);
  });
  it("refuses a split at an edge or outside, and on a locked track", () => {
    const d = base();
    expect(splitAt(d, 0).ok).toBe(false);
    expect(splitClip(d, d.clips[0]!.id, 10 * RATE).ok).toBe(false);
    const locked = must(updateTrack(d, d.tracks[0]!.id, { locked: true }));
    const r = splitClip(locked, locked.clips[0]!.id, RATE);
    expect(r).toMatchObject({ ok: false });
  });
  it("trims both edges within the source and never overlaps a neighbour", () => {
    let d = must(splitAt(base(), 5 * RATE));
    const [a, b] = clipsOnTrack(d, d.tracks[0]!.id);
    d = must(trimClip(d, a!.id, "end", 4 * RATE));
    expect(trimClip(d, b!.id, "start", 4 * RATE).ok).toBe(true); // reclaims the gap
    expect(trimClip(d, b!.id, "start", 3 * RATE).ok).toBe(true); // overlaps a: a crossfade
    expect(trimClip(d, b!.id, "start", 0).ok).toBe(false); // b would cover a entirely
    expect(trimClip(d, a!.id, "end", 5 * RATE + 1).ok).toBe(true); // a 1-sample crossfade into b
    expect(trimClip(d, a!.id, "start", -1).ok).toBe(false); // before sample 0 of the source
    expect(trimClip(d, b!.id, "end", 11 * RATE).ok).toBe(false); // past the source
    expect(trimClip(d, a!.id, "end", 0).ok).toBe(false);
  });
  it("clamps fades when a trim makes the clip shorter", () => {
    let d = base();
    d = must(setClipLevels(d, d.clips[0]!.id, { fadeIn: 5 * RATE, fadeOut: 5 * RATE }));
    d = must(trimClip(d, d.clips[0]!.id, "end", 2 * RATE));
    expect(d.clips[0]!.fadeIn + d.clips[0]!.fadeOut).toBeLessThanOrEqual(d.clips[0]!.length);
  });
  it("moves a clip, allowing crossfades but rejecting stacking and negative starts", () => {
    let d = must(splitAt(base(), 5 * RATE));
    const [a, b] = clipsOnTrack(d, d.tracks[0]!.id);
    expect(moveClip(d, a!.id, RATE).ok).toBe(true); // overlapping b by 1 s = a crossfade
    expect(moveClip(d, a!.id, 5 * RATE).ok).toBe(false); // same start as b: one on top of the other
    expect(moveClip(d, a!.id, -1).ok).toBe(false);
    d = must(moveClip(d, b!.id, 6 * RATE));
    expect(d.clips.find((c) => c.id === b!.id)!.start).toBe(6 * RATE);
  });
});

describe("levels", () => {
  it("validates gain and fades", () => {
    const d = base();
    const id = d.clips[0]!.id;
    expect(setClipLevels(d, id, { gainDb: -6 }).ok).toBe(true);
    expect(setClipLevels(d, id, { gainDb: 100 }).ok).toBe(false);
    expect(setClipLevels(d, id, { gainDb: NaN }).ok).toBe(false);
    expect(setClipLevels(d, id, { fadeIn: 6 * RATE, fadeOut: 6 * RATE }).ok).toBe(false);
    expect(setClipLevels(d, id, { fadeIn: 1.5 }).ok).toBe(false);
  });
});

describe("cutRange", () => {
  it("non-ripple leaves a gap and keeps later audio where it was", () => {
    const d = must(cutRange(base(), 2 * RATE, 4 * RATE, { ripple: false }));
    const cs = clipsOnTrack(d, d.tracks[0]!.id);
    expect(cs).toHaveLength(2);
    expect(cs[0]).toMatchObject({ start: 0, length: 2 * RATE });
    expect(cs[1]).toMatchObject({ start: 4 * RATE, srcStart: 4 * RATE, length: 6 * RATE });
    expect(editedToSource(d, d.tracks[0]!.id, 3 * RATE)).toBeNull();
  });
  it("ripple closes the gap: later audio moves earlier by exactly the cut width", () => {
    const d = must(cutRange(base(), 2 * RATE, 4 * RATE, { ripple: true }));
    const cs = clipsOnTrack(d, d.tracks[0]!.id);
    expect(cs[1]).toMatchObject({ start: 2 * RATE, srcStart: 4 * RATE, length: 6 * RATE });
    expect(projectLength(d)).toBe(8 * RATE);
    expect(editedToSource(d, d.tracks[0]!.id, 2 * RATE)).toEqual({ sourceId: "s1", sample: 4 * RATE });
  });
  it("keeps tracks in sync: the same source instant lands at the same place on linked tracks", () => {
    const d = must(cutRange(twoTracks(), 2 * RATE, 4 * RATE, { ripple: true }));
    for (const s of ["s1", "s2"]) expect(sourceToEdited(d, s, 7 * RATE)).toBe(5 * RATE);
    expect(sourceToEdited(d, "s1", 3 * RATE)).toBeNull();
    expect(sourceToEdited(d, "s2", 3 * RATE)).toBeNull();
  });
  it("handles a range spanning several clips and one that touches clip edges exactly", () => {
    let d = must(splitAt(base(), 3 * RATE));
    d = must(splitAt(d, 6 * RATE));
    d = must(cutRange(d, 3 * RATE, 6 * RATE, { ripple: true }));
    const cs = clipsOnTrack(d, d.tracks[0]!.id);
    expect(cs.map((c) => [c.start, c.srcStart, c.length])).toEqual([
      [0, 0, 3 * RATE],
      [3 * RATE, 6 * RATE, 4 * RATE],
    ]);
  });
  it("a cut inside one clip splits it into two with fresh ids", () => {
    const d = must(cutRange(base(), RATE, 2 * RATE, { ripple: false }));
    expect(new Set(d.clips.map((c) => c.id)).size).toBe(2);
  });
  it("refuses ripple when a track with audio is locked or left out, but allows it non-ripple", () => {
    const d = twoTracks();
    const lockedGuest = must(updateTrack(d, d.tracks[1]!.id, { locked: true }));
    expect(cutRange(lockedGuest, RATE, 2 * RATE, { ripple: true }).ok).toBe(false);
    expect(cutRange(d, RATE, 2 * RATE, { ripple: true, trackIds: [d.tracks[0]!.id] }).ok).toBe(false);
    expect(cutRange(lockedGuest, RATE, 2 * RATE, { ripple: false, trackIds: [d.tracks[0]!.id] }).ok).toBe(true);
    expect(cutRange(lockedGuest, RATE, 2 * RATE, { ripple: false }).ok).toBe(false); // would touch locked audio
  });
  it("rejects bad ranges", () => {
    expect(cutRange(base(), 5, 5, { ripple: true }).ok).toBe(false);
    expect(cutRange(base(), -1, 5, { ripple: true }).ok).toBe(false);
  });
  it("cutRanges applies several cuts as one edit, in any order, and rejects overlaps", () => {
    const ranges = [
      { from: 6 * RATE, to: 7 * RATE },
      { from: 1 * RATE, to: 2 * RATE },
    ];
    const d = must(cutRanges(twoTracks(), ranges, { ripple: true }));
    expect(projectLength(d)).toBe(8 * RATE);
    expect(sourceToEdited(d, "s2", 8 * RATE)).toBe(6 * RATE);
    expect(cutRanges(base(), [{ from: 0, to: 5 }, { from: 3, to: 9 }], { ripple: true }).ok).toBe(false);
  });
});

describe("annotations follow the audio", () => {
  it("keeps retakes on playing audio at their new position and hides ones that were cut", () => {
    const d0 = base([RATE, 3 * RATE, 8 * RATE]);
    const d = must(cutRange(d0, 2 * RATE, 4 * RATE, { ripple: true }));
    expect(annotationPositions(d).map((a) => a.at)).toEqual([RATE, 6 * RATE]);
    expect(d.annotations).toHaveLength(3); // still stored, so undo/restore keeps them
  });
  it("adds chapters on a source position", () => {
    const d = must(addChapter(base(), "s1", 4 * RATE, " Intro "));
    expect(d.annotations.at(-1)).toMatchObject({ kind: "chapter", label: "Intro" });
    expect(addChapter(base(), "s1", 99 * RATE, "x").ok).toBe(false);
    expect(addChapter(base(), "s1", 5, "  ").ok).toBe(false);
  });
});

describe("tracks", () => {
  it("clamps heights to 64–260 and validates names", () => {
    const d = base();
    const t = d.tracks[0]!.id;
    expect(must(updateTrack(d, t, { height: 10 })).tracks[0]!.height).toBe(64);
    expect(must(updateTrack(d, t, { height: 999 })).tracks[0]!.height).toBe(260);
    expect(updateTrack(d, t, { name: " " }).ok).toBe(false);
  });
});

describe("parseProject", () => {
  it("accepts what the editor produces and drops unknown fields", () => {
    const d = must(cutRange(twoTracks(), RATE, 2 * RATE, { ripple: true }));
    const r = parseProject(JSON.parse(JSON.stringify({ ...d, evil: 1 })));
    expect(r.ok).toBe(true);
    expect(r.ok && r.doc).toEqual(d);
  });
  it("rejects bad shapes, out-of-source clips, overlaps and duplicate ids", () => {
    const d = base();
    const bad = (mut: (x: any) => void) => {
      const c = JSON.parse(JSON.stringify(d));
      mut(c);
      return parseProject(c).ok;
    };
    expect(parseProject(null).ok).toBe(false);
    expect(bad((x) => (x.schemaVersion = 2))).toBe(false);
    expect(bad((x) => (x.clips[0].length = 11 * RATE))).toBe(false);
    expect(bad((x) => (x.clips[0].length = 1.5))).toBe(false);
    expect(bad((x) => (x.clips[0].trackId = "nope"))).toBe(false);
    expect(bad((x) => (x.clips[0].gainDb = 999))).toBe(false);
    expect(bad((x) => x.clips.push({ ...x.clips[0], id: "dup", start: 0 }))).toBe(false); // stacked exactly on top
    expect(bad((x) => x.clips.push({ ...x.clips[0] }))).toBe(false); // duplicate id
    expect(bad((x) => (x.tracks = []))).toBe(false);
    expect(bad((x) => (x.tracks[0].kind = "drums"))).toBe(false);
    expect(bad(() => {})).toBe(true);
  });
});

describe("history", () => {
  it("undoes and redoes a ripple cut across linked tracks as one step", () => {
    const d0 = twoTracks();
    let h = createHistory(d0);
    h = commit(h, must(cutRange(h.present, RATE, 2 * RATE, { ripple: true })));
    expect(projectLength(h.present)).toBe(9 * RATE);
    h = undo(h);
    expect(h.present).toBe(d0);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(projectLength(h.present)).toBe(9 * RATE);
  });
  it("a new edit clears redo; same-group edits within the window merge", () => {
    let h = createHistory(base());
    const id = h.present.clips[0]!.id;
    h = commit(h, must(setClipLevels(h.present, id, { gainDb: -1 })), { group: "gain", now: 1000 });
    h = commit(h, must(setClipLevels(h.present, id, { gainDb: -2 })), { group: "gain", now: 1200 });
    h = commit(h, must(setClipLevels(h.present, id, { gainDb: -3 })), { group: "gain", now: 1400 });
    expect(h.past).toHaveLength(1);
    h = undo(h);
    expect(h.present.clips[0]!.gainDb).toBe(0);
    h = commit(h, must(setClipLevels(h.present, id, { gainDb: 3 })), { now: 5000 });
    expect(canRedo(h)).toBe(false);
  });
});

describe("addSourceClip / freeSpot", () => {
  const music = { id: "m1", assetId: "am", label: "Theme", totalSamples: 3 * RATE };
  it("adds a source on a new track at a position", () => {
    const d = must(addSourceClip(base(), { source: music, newTrack: { kind: "music" }, at: 2 * RATE }));
    expect(d.tracks.map((t) => t.kind)).toEqual(["host", "music"]);
    expect(d.sources.map((s) => s.id)).toEqual(["s1", "m1"]);
    expect(d.clips.at(-1)).toMatchObject({ sourceId: "m1", srcStart: 0, length: 3 * RATE, start: 2 * RATE, trackId: d.tracks[1]!.id });
    expect(parseProject(JSON.parse(JSON.stringify(d))).ok).toBe(true);
  });
  it("refuses overlap, locked tracks, duplicates and empty audio; freeSpot finds the next gap", () => {
    const d = base();
    const t = d.tracks[0]!.id;
    expect(addSourceClip(d, { source: music, trackId: t, at: 5 * RATE }).ok).toBe(false); // overlaps the 10 s clip
    expect(freeSpot(d, t, 5 * RATE, 3 * RATE)).toBe(10 * RATE);
    expect(addSourceClip(d, { source: music, trackId: t, at: freeSpot(d, t, 0, 3 * RATE) }).ok).toBe(true);
    const locked = must(updateTrack(d, t, { locked: true }));
    expect(addSourceClip(locked, { source: music, trackId: t, at: 20 * RATE }).ok).toBe(false);
    // the same audio again (a jingle used twice) reuses its source instead of adding a second copy
    const twice = must(addSourceClip(d, { source: { ...music, id: "other", assetId: "a1" }, trackId: t, at: 20 * RATE }));
    expect(twice.sources).toHaveLength(1);
    expect(twice.clips.at(-1)).toMatchObject({ sourceId: "s1", length: 10 * RATE });
    expect(addSourceClip(d, { source: { ...music, id: "s1", assetId: "different" }, trackId: t, at: 20 * RATE }).ok).toBe(false); // a clashing source id is still refused
    expect(addSourceClip(d, { source: { ...music, totalSamples: 0 }, newTrack: { kind: "sfx" }, at: 0 }).ok).toBe(false);
    expect(addSourceClip(d, { source: music, at: 0 }).ok).toBe(false);
  });
  it("freeSpot slips past several clips and fits in a gap that is big enough", () => {
    let d = must(cutRange(base(), 2 * RATE, 4 * RATE, { ripple: false })); // clips [0,2) and [4,10)
    const t = d.tracks[0]!.id;
    expect(freeSpot(d, t, RATE, RATE / 2)).toBe(2 * RATE); // gap [2,4) fits half a second after 2 s
    expect(freeSpot(d, t, 0, 3 * RATE)).toBe(10 * RATE); // gap too small → after everything
    d = must(updateTrack(d, t, { name: "x" }));
  });
});

describe("track colour and delete", () => {
  it("sets, normalises, validates and resets a custom colour, and it survives parsing", () => {
    let d = base();
    const t = d.tracks[0]!.id;
    expect(d.tracks[0]!.color).toBeUndefined();
    d = must(updateTrack(d, t, { color: "#5B8DEF" }));
    expect(d.tracks[0]!.color).toBe("#5b8def");
    expect(updateTrack(d, t, { color: "red" }).ok).toBe(false);
    expect(updateTrack(d, t, { color: "#5b8def;background:url(x)" }).ok).toBe(false);
    expect(must(parseProject(JSON.parse(JSON.stringify(d)))).tracks[0]!.color).toBe("#5b8def");
    expect(parseProject({ ...d, tracks: [{ ...d.tracks[0], color: "javascript:1" }] }).ok).toBe(false);
    d = must(updateTrack(d, t, { color: null }));
    expect("color" in d.tracks[0]!).toBe(false);
  });

  it("deletes a track with its clips, refuses the last or a locked track", () => {
    let d = addTrack(base(), "music");
    const music = d.tracks[1]!.id;
    d = must(addSourceClip(d, { source: { id: "s2", assetId: "a2", label: "Bed", totalSamples: RATE }, trackId: music, at: 0 }));
    const gone = must(removeTrack(d, music));
    expect(gone.tracks.map((t) => t.kind)).toEqual(["host"]);
    expect(gone.clips.some((c) => c.trackId === music)).toBe(false);
    expect(removeTrack(gone, gone.tracks[0]!.id).ok).toBe(false);
    expect(removeTrack(must(updateTrack(d, music, { locked: true })), music).ok).toBe(false);
  });
});

describe("crossfades", () => {
  it("an overlap fades the earlier clip out and the later one in across it", () => {
    let d = must(splitAt(base(), 5 * RATE));
    const [a, b] = clipsOnTrack(d, d.tracks[0]!.id);
    d = must(moveClip(d, b!.id, 4 * RATE)); // b now overlaps a by 1 s
    const xf = withCrossfades(d);
    expect(xf.get(a!.id)!.fadeOut).toBe(RATE);
    expect(xf.get(b!.id)!.fadeIn).toBe(RATE);
    expect(crossfades(d, d.tracks[0]!.id)).toEqual([{ from: 4 * RATE, to: 5 * RATE, outId: a!.id, inId: b!.id }]);
    // the stored clips are untouched: pull them apart and the crossfade is gone
    d = must(moveClip(d, b!.id, 6 * RATE));
    expect(withCrossfades(d).get(a!.id)!.fadeOut).toBe(0);
  });

  it("a user fade longer than the overlap wins", () => {
    let d = must(splitAt(base(), 5 * RATE));
    const [a, b] = clipsOnTrack(d, d.tracks[0]!.id);
    d = must(setClipLevels(d, a!.id, { fadeOut: 2 * RATE }));
    d = must(moveClip(d, b!.id, 4.5 * RATE));
    expect(withCrossfades(d).get(a!.id)!.fadeOut).toBe(2 * RATE);
    expect(withCrossfades(d).get(b!.id)!.fadeIn).toBe(RATE / 2);
  });

  it("never three at once", () => {
    const mk = (id: string, start: number, length: number) => ({ id, trackId: "t", sourceId: "s", srcStart: 0, length, start, gainDb: 0, fadeIn: 0, fadeOut: 0 });
    expect(layoutProblem([mk("a", 0, 100), mk("b", 50, 100)])).toBeNull();
    expect(layoutProblem([mk("a", 0, 100), mk("b", 50, 100), mk("c", 90, 100)])).toMatch(/two clips/);
    expect(layoutProblem([mk("a", 0, 100), mk("b", 20, 30)])).toMatch(/entirely/);
  });
});

describe("removeSource", () => {
  it("drops the source, its clips and its marks, nothing else", () => {
    let d = createProject({ sampleRate: RATE, source: { id: "s1", assetId: "a1", label: "Take", totalSamples: 10 * RATE, retakes: [RATE] } });
    d = must(addSourceClip(d, { source: { id: "s2", assetId: "a2", label: "Bed", totalSamples: RATE }, newTrack: { kind: "music" }, at: 0 }));
    const r = removeSource(d, "s1");
    expect(r.sources.map((s) => s.id)).toEqual(["s2"]);
    expect(r.clips.every((c) => c.sourceId === "s2")).toBe(true);
    expect(r.annotations).toEqual([]);
    expect(r.tracks).toEqual(d.tracks);
    expect(parseProject(JSON.parse(JSON.stringify(r))).ok).toBe(true);
  });
});

describe("track volume", () => {
  it("clamps to −60…+12 dB in 0.1 dB steps, drops 0 dB, survives parsing, rejects junk", () => {
    let d = base();
    const t = d.tracks[0]!.id;
    expect(must(updateTrack(d, t, { gainDb: 30 })).tracks[0]!.gainDb).toBe(12);
    expect(must(updateTrack(d, t, { gainDb: -100 })).tracks[0]!.gainDb).toBe(-60);
    d = must(updateTrack(d, t, { gainDb: -6.04 }));
    expect(d.tracks[0]!.gainDb).toBe(-6);
    expect(must(parseProject(JSON.parse(JSON.stringify(d)))).tracks[0]!.gainDb).toBe(-6);
    expect("gainDb" in must(updateTrack(d, t, { gainDb: 0 })).tracks[0]!).toBe(false);
    expect(updateTrack(d, t, { gainDb: Number.NaN }).ok).toBe(false);
    expect(parseProject({ ...d, tracks: [{ ...d.tracks[0], gainDb: 99 }] }).ok).toBe(false);
  });
});
