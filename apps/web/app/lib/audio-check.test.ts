import { describe, expect, it } from "vitest";
import { looksLikeMp3 } from "./audio-check";

describe("looksLikeMp3", () => {
  it("accepts an ID3v2 header", () => expect(looksLikeMp3(Uint8Array.from([0x49, 0x44, 0x33, 4, 0]))).toBe(true));
  it("accepts an MPEG frame sync", () => expect(looksLikeMp3(Uint8Array.from([0xff, 0xfb, 0x90]))).toBe(true));
  it("rejects other formats", () => {
    expect(looksLikeMp3(Uint8Array.from([0x52, 0x49, 0x46, 0x46]))).toBe(false); // RIFF/WAV
    expect(looksLikeMp3(Uint8Array.from([0xff, 0x00, 0x00]))).toBe(false);
  });
  it("rejects too-short input", () => expect(looksLikeMp3(Uint8Array.from([0xff, 0xfb]))).toBe(false));
});
