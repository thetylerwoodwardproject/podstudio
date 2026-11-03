import { describe, expect, it } from "vitest";
import { renderWav } from "@podstudio/audio/render";
import { DUCK, addDuckRule, addTrack, createProject, parseProject, removeDuckRule, removeTrack, triggerTrackIds, updateDuckRule, updateTrack, type ProjectDoc } from "./document";
import { duckGains, newDuckState } from "@podstudio/audio/duck";

const R = 48_000;
const must = (r: any): ProjectDoc => {
  if (!r.ok) throw new Error(r.error);
  return r.doc;
};
const tone = (secs: number, hz: number, amp: number, on: [number, number][]) => {
  const x = new Float32Array(secs * R);
  for (const [a, b] of on) for (let i = Math.round(a * R); i < Math.round(b * R); i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / R);
  return x;
};
// host speaks 2–4 s and 6–8 s (220 Hz); music is a steady 440 Hz bed
const SRC: Record<string, Float32Array> = { host: tone(10, 220, 0.3, [[2, 4], [6, 8]]), music: tone(10, 440, 0.2, [[0, 10]]), guest: tone(10, 330, 0.3, [[4.5, 5.5]]) };
const read = async (id: string, from: number, count: number) => [SRC[id]!.slice(from, from + count)];

function build(opts: { guest?: boolean } = {}) {
  let d = createProject({ sampleRate: R, source: { id: "host", assetId: "h", label: "host", totalSamples: 10 * R } });
  d = { ...d, sources: [...d.sources, { id: "music", assetId: "m", label: "music", totalSamples: 10 * R }, { id: "guest", assetId: "g", label: "guest", totalSamples: 10 * R }] };
  d = addTrack(d, "music");
  d = { ...d, clips: [...d.clips, { id: "cm", trackId: d.tracks[1]!.id, sourceId: "music", srcStart: 0, length: 10 * R, start: 0, gainDb: 0, fadeIn: 0, fadeOut: 0 }] };
  if (opts.guest) {
    d = addTrack(d, "guest");
    d = { ...d, clips: [...d.clips, { id: "cg", trackId: d.tracks[2]!.id, sourceId: "guest", srcStart: 0, length: 10 * R, start: 0, gainDb: 0, fadeIn: 0, fadeOut: 0 }] };
  }
  return d;
}
async function render(doc: ProjectDoc) {
  const parts: Uint8Array[] = [];
  for await (const c of renderWav({ doc, bitDepth: 24, sampleRate: 48000, read })) parts.push(c);
  const bytes = Buffer.concat(parts.map((p) => Buffer.from(p)));
  const n = (bytes.length - 44) / 3;
  const out = new Float32Array(n);
  for (let i = 0, o = 44; i < n; i++, o += 3) {
    let v = bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16);
    if (v & 0x800000) v |= ~0xffffff;
    out[i] = v / 8388608;
  }
  return out;
}
/** Amplitude of one frequency in [a, b) seconds. */
function amp(x: Float32Array, hz: number, a: number, b: number) {
  const w = x.subarray(Math.round(a * R), Math.round(b * R));
  const c = 2 * Math.cos((2 * Math.PI * hz) / R);
  let s1 = 0, s2 = 0;
  for (const v of w) { const s = v + c * s1 - s2; s2 = s1; s1 = s; }
  return (2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2))) / w.length;
}
const db = (x: number) => 20 * Math.log10(x);

describe("ducking in the render", () => {
  it("turns the music down under the host by the set amount, then brings it back", async () => {
    const d = must(addDuckRule(build()));
    const out = await render(d);
    const music = (a: number, b: number) => amp(out, 440, a, b);
    expect(db(music(0.5, 1.5))).toBeCloseTo(db(0.2), 0); // before anyone speaks: untouched
    expect(db(music(3, 3.9)) - db(0.2)).toBeCloseTo(-12, 0); // under the host: −12 dB
    expect(db(music(5.2, 5.8))).toBeGreaterThan(db(0.2) - 1.5); // recovered in the gap (release 450 ms)
    expect(db(music(7, 7.9)) - db(0.2)).toBeCloseTo(-12, 0); // ducks again
    expect(db(music(9.3, 9.9))).toBeGreaterThan(db(0.2) - 0.5); // and recovers
    expect(amp(out, 220, 2.5, 3.5)).toBeCloseTo(0.3, 1); // the voice itself is never touched
  });
  it("blocked rendering matches a one-pass reference of the same rule (residual far below −60 dBFS)", async () => {
    const d = must(addDuckRule(build()));
    const out = await render(d);
    const r = d.ducking![0]!;
    const music = d.tracks[1]!.id;
    expect(r.targets).toEqual([music]);
    const sig = SRC.host!;
    const g = duckGains(sig, r, R, newDuckState());
    const want = new Float32Array(10 * R);
    for (let i = 0; i < want.length; i++) want[i] = sig[i]! + SRC.music![i]! * g[i]!;
    let s = 0;
    for (let i = 0; i < want.length; i++) s += (out[i]! - want[i]!) ** 2;
    expect(10 * Math.log10(s / want.length + 1e-20)).toBeLessThan(-100);
  });
  it("a muted trigger, a disabled rule, or no rule all leave the music alone", async () => {
    const base = must(addDuckRule(build()));
    const id = base.ducking![0]!.id;
    const mutedHost = must(updateTrack(base, base.tracks[0]!.id, { muted: true }));
    expect(db(amp(await render(mutedHost), 440, 3, 3.9))).toBeCloseTo(db(0.2), 0);
    const off = must(updateDuckRule(base, id, { enabled: false }));
    expect(db(amp(await render(off), 440, 3, 3.9))).toBeCloseTo(db(0.2), 0);
  });
  it("'all host and guest' reacts to the guest too, but picked tracks react only to those", async () => {
    const d = build({ guest: true });
    const speech = must(addDuckRule(d));
    expect(db(amp(await render(speech), 440, 4.8, 5.3)) - db(0.2)).toBeCloseTo(-12, 0);
    const hostOnly = must(updateDuckRule(speech, speech.ducking![0]!.id, { triggers: [d.tracks[0]!.id] }));
    expect(db(amp(await render(hostOnly), 440, 5.1, 5.4))).toBeGreaterThan(db(0.2) - 1); // released by now, the guest doesn't duck
    expect(db(amp(await render(hostOnly), 440, 3, 3.9)) - db(0.2)).toBeCloseTo(-12, 0);
  });
  it("amount, threshold and release do what they say", async () => {
    const d = must(addDuckRule(build()));
    const id = d.ducking![0]!.id;
    const deep = must(updateDuckRule(d, id, { amountDb: -24 }));
    expect(db(amp(await render(deep), 440, 3, 3.9)) - db(0.2)).toBeCloseTo(-24, 0);
    const deaf = must(updateDuckRule(d, id, { thresholdDb: -10 })); // −10 dBFS: the 0.3-amplitude voice (−10.5 dBFS) doesn't reach it
    expect(db(amp(await render(deaf), 440, 3, 3.9))).toBeGreaterThan(db(0.2) - 0.5);
    const slow = must(updateDuckRule(d, id, { releaseMs: 3000 }));
    expect(db(amp(await render(slow), 440, 4.6, 5.0)) - db(0.2)).toBeLessThan(-6); // still low half a second after the voice stopped
  });
});

describe("ducking rules in the document", () => {
  it("need a music/SFX track to start with; defaults duck music+sfx under host+guest", () => {
    expect(addDuckRule(createProject({ sampleRate: R, source: { id: "s", assetId: "a", label: "x", totalSamples: R } })).ok).toBe(false);
    const d = must(addDuckRule(build({ guest: true })));
    expect(d.ducking![0]).toMatchObject({ enabled: true, triggers: "speech", amountDb: DUCK.amountDb.default });
    expect(d.ducking![0]!.targets).toEqual([d.tracks[1]!.id]);
    expect(triggerTrackIds(d, d.ducking![0]!)).toEqual([d.tracks[0]!.id, d.tracks[2]!.id]);
  });
  it("a track can't be both ducked and a trigger of the same rule; values are clamped; at least one target stays", () => {
    const d0 = build({ guest: true });
    const d = must(addDuckRule(d0));
    const id = d.ducking![0]!.id;
    const [host, music, guest] = d.tracks.map((t) => t.id) as [string, string, string];
    const a = must(updateDuckRule(d, id, { triggers: [host, music] }));
    expect(a.ducking![0]!.triggers).toEqual([host]); // the ducked track is dropped from the triggers
    const b = must(updateDuckRule(d, id, { targets: [music, guest], triggers: [host, guest] }));
    expect(b.ducking![0]!.triggers).toEqual([host]);
    expect(must(updateDuckRule(d, id, { amountDb: -99, thresholdDb: 5, attackMs: 0, releaseMs: 99999 })).ducking![0]).toMatchObject({ amountDb: -40, thresholdDb: -10, attackMs: 1, releaseMs: 3000 });
    expect(updateDuckRule(d, id, { targets: [] }).ok).toBe(false);
    expect(updateDuckRule(d, id, { amountDb: NaN }).ok).toBe(false);
  });
  it("removing a track updates or drops the rules that mention it; removing a rule works", () => {
    const d = must(addDuckRule(build({ guest: true })));
    const id = d.ducking![0]!.id;
    const guestId = d.tracks[2]!.id;
    const withList = must(updateDuckRule(d, id, { triggers: [d.tracks[0]!.id, guestId] }));
    expect(must(removeTrack(withList, guestId)).ducking![0]!.triggers).toEqual([d.tracks[0]!.id]);
    expect(must(removeTrack(d, d.tracks[1]!.id)).ducking).toEqual([]); // its only target is gone
    expect(removeDuckRule(d, id).ducking).toEqual([]);
  });
  it("survive a save/load round trip and reject nonsense; old projects without the field still load", () => {
    const d = must(addDuckRule(build({ guest: true })));
    expect(parseProject(JSON.parse(JSON.stringify(d)))).toEqual({ ok: true, doc: d });
    const old = JSON.parse(JSON.stringify(build()));
    expect(parseProject(old).ok).toBe(true);
    const bad = (m: (x: any) => void) => { const c = JSON.parse(JSON.stringify(d)); m(c); return parseProject(c).ok; };
    expect(bad((x) => (x.ducking[0].targets = ["nope"]))).toBe(false);
    expect(bad((x) => (x.ducking[0].targets = []))).toBe(false);
    expect(bad((x) => (x.ducking[0].amountDb = 5))).toBe(false);
    expect(bad((x) => (x.ducking[0].triggers = "everyone"))).toBe(false);
    expect(bad((x) => x.ducking.push({ ...x.ducking[0] }))).toBe(false);
    expect(bad(() => {})).toBe(true);
  });
});

describe("the preview's 10 ms gain curve", () => {
  it("stays within 0.2 dB of the exact per-sample ducking gain the export uses", () => {
    const d = must(addDuckRule(build()));
    const r = d.ducking![0]!;
    const exact = duckGains(SRC.host!, r, R, newDuckState());
    const step = Math.round(R * 0.01);
    let worst = 0;
    for (let i = 0; i + step < exact.length; i += step) {
      for (let k = 0; k <= step; k += 80) {
        const lin = exact[i]! + ((exact[i + step]! - exact[i]!) * k) / step; // what Web Audio does between curve points
        worst = Math.max(worst, Math.abs(20 * Math.log10(lin) - 20 * Math.log10(exact[i + k]!)));
      }
    }
    expect(worst).toBeLessThan(0.2);
  });
});
