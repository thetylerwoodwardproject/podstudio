import { describe, expect, it } from "vitest";
import {
  CAPTURE,
  RETAKE_TONE,
  findRetakeTones,
  floatToPcm24,
  goertzel,
  parseWavHeader,
  pcm24ToFloat,
  toneLength,
  toneSample,
  wavHeader,
} from "./capture-contract";

describe("PCM 24-bit", () => {
  it("round-trips within one least-significant bit and clips", () => {
    const src = new Float32Array([0, 0.5, -0.5, 1, -1, 0.123456, -0.987654, 2, -2]);
    const back = pcm24ToFloat(floatToPcm24(src));
    for (let i = 0; i < src.length; i++) expect(Math.abs(back[i]! - Math.max(-1, Math.min(1, src[i]!)))).toBeLessThan(1 / 0x7fffff + 1e-9);
    expect(floatToPcm24(new Float32Array(10)).length).toBe(30);
  });
  it("is little-endian two's complement", () => {
    expect([...floatToPcm24(new Float32Array([1]))]).toEqual([0xff, 0xff, 0x7f]);
    expect([...floatToPcm24(new Float32Array([-1]))]).toEqual([0x00, 0x00, 0x80]);
  });
});

describe("WAV header", () => {
  it("builds and parses a 48 kHz mono 24-bit header", () => {
    const h = wavHeader({ sampleRate: 48000, channels: 1, bitDepth: 24 }, 288000);
    expect(h.length).toBe(44);
    expect(parseWavHeader(h)).toEqual({ sampleRate: 48000, channels: 1, bitDepth: 24, dataBytes: 288000, samples: 96000 });
    expect(new DataView(h.buffer).getUint32(4, true)).toBe(36 + 288000);
    expect(new DataView(h.buffer).getUint32(28, true)).toBe(144000); // byte rate
  });
  it("rejects junk", () => expect(parseWavHeader(new Uint8Array(44))).toBeNull());
});

describe("retake tone", () => {
  const sr = CAPTURE.sampleRate;
  it("is 250 ms, silent outside, peaks near −6 dBFS, and fades in and out", () => {
    expect(toneLength(sr)).toBe(12000);
    expect(toneSample(-1, sr)).toBe(0);
    expect(toneSample(12000, sr)).toBe(0);
    expect(toneSample(0, sr)).toBe(0);
    let peak = 0;
    for (let i = 0; i < 12000; i++) peak = Math.max(peak, Math.abs(toneSample(i, sr)));
    expect(peak).toBeGreaterThan(RETAKE_TONE.peak * 0.98);
    expect(peak).toBeLessThanOrEqual(RETAKE_TONE.peak);
  });
  it("is found by the detector at the right place, and not in speech-like or silent audio", () => {
    const pcm = new Float32Array(sr * 3);
    // a 220 Hz "voice" bed at −20 dBFS
    for (let i = 0; i < pcm.length; i++) pcm[i] = 0.1 * Math.sin((2 * Math.PI * 220 * i) / sr);
    const at = [Math.round(sr * 0.8), Math.round(sr * 2.0)];
    for (const s of at) for (let i = 0; i < toneLength(sr); i++) pcm[s + i] += toneSample(i, sr);
    const found = findRetakeTones(pcm, sr);
    expect(found).toHaveLength(2);
    found.forEach((f, k) => expect(Math.abs(f - at[k]!)).toBeLessThan(sr * 0.05));
    expect(findRetakeTones(new Float32Array(sr), sr)).toEqual([]);
    const bed = new Float32Array(sr);
    for (let i = 0; i < bed.length; i++) bed[i] = 0.1 * Math.sin((2 * Math.PI * 220 * i) / sr);
    expect(findRetakeTones(bed, sr)).toEqual([]);
  });
  it("goertzel measures amplitude", () => {
    const w = new Float32Array(1200);
    for (let i = 0; i < w.length; i++) w[i] = 0.4 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
    expect(goertzel(w, 48000, 1000)).toBeCloseTo(0.4, 1);
    expect(goertzel(w, 48000, 3000)).toBeLessThan(0.02);
  });
});
