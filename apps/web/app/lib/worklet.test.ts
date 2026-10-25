import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAPTURE, RETAKE_TONE, toneLength, toneSample } from "./capture-contract";

// Loads public/pcm-capture.worklet.js into a fake AudioWorklet scope and drives it
// directly, so the worklet's tone, sample counting and flushing are tested against
// the shared contract rather than trusted.
function loadProcessor() {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, "../../public/pcm-capture.worklet.js"), "utf8");
  let Ctor: any;
  const factory = new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", src);
  class Base {
    port: any = { onmessage: null as any, posted: [] as any[], postMessage(m: any) { this.posted.push(m); } };
  }
  factory(Base, (_n: string, c: any) => (Ctor = c), CAPTURE.sampleRate);
  // Tests drive a processor that has already been told to begin recording (see the "metering only" test for before that).
  return (postSamples = 4800, begin = true) => {
    const p = new Ctor({ processorOptions: { postSamples } }) as { port: any; process: (i: Float32Array[][]) => boolean };
    if (begin) p.port.onmessage({ data: { type: "begin" } });
    return p;
  };
}

const quantum = (v: number) => [[new Float32Array(128).fill(v)]];

describe("pcm-capture worklet", () => {
  const make = loadProcessor();

  it("counts samples and posts blocks with their first-sample position", () => {
    const p = make(256);
    for (let i = 0; i < 4; i++) p.process(quantum(0.25));
    const blocks = p.port.posted.filter((m: any) => m.type === "pcm");
    expect(blocks.map((b: any) => [b.first, b.samples.length])).toEqual([[0, 256], [256, 256]]);
    expect(blocks[0].samples[0]).toBeCloseTo(0.25);
  });

  it("flushes the partial block on stop and reports the total", () => {
    const p = make(1000);
    p.process(quantum(0.1));
    p.port.onmessage({ data: { type: "stop" } });
    const m = p.port.posted;
    expect(m.find((x: any) => x.type === "pcm").samples.length).toBe(128);
    expect(m.find((x: any) => x.type === "stopped").total).toBe(128);
    expect(p.process(quantum(0))).toBe(false);
  });

  it("injects exactly the contract tone starting at the next quantum, and reports where", () => {
    const p = make(48000);
    for (let i = 0; i < 3; i++) p.process(quantum(0)); // 384 samples
    p.port.onmessage({ data: { type: "retake" } });
    const q = toneLength(CAPTURE.sampleRate) / 128 + 4;
    for (let i = 0; i < q; i++) p.process(quantum(0));
    p.port.onmessage({ data: { type: "stop" } });
    const retake = p.port.posted.find((m: any) => m.type === "retake");
    expect(retake.sample).toBe(384);
    const all = new Float32Array(p.port.posted.filter((m: any) => m.type === "pcm").flatMap((m: any) => [...m.samples]));
    for (const i of [0, 1, 100, 1000, 6000, 11999]) expect(all[384 + i]).toBeCloseTo(toneSample(i, CAPTURE.sampleRate), 6);
    expect(all[384 + toneLength(CAPTURE.sampleRate)]).toBe(0); // silent again after the tone
    expect(all[383]).toBe(0);
  });

  it("adds the tone on top of the mic signal and clips to ±1", () => {
    const p = make(48000);
    p.process(quantum(0.9));
    p.port.onmessage({ data: { type: "retake" } });
    for (let i = 0; i < 100; i++) p.process(quantum(0.9));
    p.port.onmessage({ data: { type: "stop" } });
    const all = new Float32Array(p.port.posted.filter((m: any) => m.type === "pcm").flatMap((m: any) => [...m.samples]));
    expect(Math.max(...all)).toBeLessThanOrEqual(1);
    expect(all.some((v) => v >= 0.999)).toBe(true);
    expect(RETAKE_TONE.peak).toBe(0.5);
  });

  it("ignores a second K while a tone is still playing", () => {
    const p = make(48000);
    p.port.onmessage({ data: { type: "retake" } });
    p.process(quantum(0));
    p.port.onmessage({ data: { type: "retake" } });
    p.process(quantum(0));
    expect(p.port.posted.filter((m: any) => m.type === "retake")).toHaveLength(1);
  });

  it("before begin it only meters: nothing is buffered and the sample clock stays at 0", () => {
    const p = make(256, false);
    for (let i = 0; i < 100; i++) p.process(quantum(0.3));
    p.port.onmessage({ data: { type: "retake" } }); // ignored: not recording
    expect(p.port.posted.filter((m: any) => m.type === "pcm")).toHaveLength(0);
    expect(p.port.posted.filter((m: any) => m.type === "meter").every((m: any) => m.total === 0)).toBe(true);
    p.port.onmessage({ data: { type: "begin" } });
    p.process(quantum(0.3));
    p.port.onmessage({ data: { type: "stop" } });
    const stopped = p.port.posted.find((m: any) => m.type === "stopped");
    expect(stopped.total).toBe(128); // the clock started at begin, not when the mic opened
    expect(p.port.posted.filter((m: any) => m.type === "retake")).toHaveLength(0);
  });

  it("sends meter updates roughly every 50 ms", () => {
    const p = make(48000);
    for (let i = 0; i < 40; i++) p.process(quantum(0.5)); // 5120 samples ≈ 107 ms
    const meters = p.port.posted.filter((m: any) => m.type === "meter");
    expect(meters.length).toBe(2);
    expect(meters[0].peak).toBeCloseTo(0.5);
    expect(meters[0].rms).toBeCloseTo(0.5);
  });
});
