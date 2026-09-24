import { test } from 'node:test';
import assert from 'node:assert/strict';

// Run the capture worklet outside an AudioContext: stub the worklet globals, load it, drive process().
type Msg = { type: string; peak?: number; samples?: Float32Array };
const g = globalThis as Record<string, unknown>;
let Processor: new (o: unknown) => { process(i: Float32Array[][]): boolean; port: { onmessage: (e: { data: string }) => void } };
g.sampleRate = 48000;
g.AudioWorkletProcessor = class {
  sent: Msg[] = [];
  port = { postMessage: (m: Msg) => this.sent.push(m), onmessage: (_: { data: string }) => {} };
};
g.registerProcessor = (_: string, c: typeof Processor) => (Processor = c);
await import('../../../public/worklets/recorder.js');

function run(options: object, input: Float32Array[], record = false) {
  const p = new Processor({ processorOptions: options }) as InstanceType<typeof Processor> & { sent: Msg[] };
  if (record) p.port.onmessage({ data: 'record' });
  // 1600 samples reaches one level message (48000 / 30).
  for (let n = 0; n < 1600 / 128; n++) p.process([input]);
  if (record) p.port.onmessage({ data: 'stop' });
  return { level: p.sent.find((m) => m.type === 'level')!, chunks: p.sent.filter((m) => m.type === 'chunk') };
}

const block = (v: number) => new Float32Array(128).fill(v);

test('a full-scale mic on input 1 of a two-input interface meters 0 dBFS, not -6', () => {
  const { level } = run({ channel: null }, [block(1), block(0)]);
  assert.equal(level.peak, 1);
});

test('mono summed records the single mic at its own level', () => {
  const { chunks } = run({ channel: null }, [block(0.5), block(0)], true);
  assert.equal(chunks[0].samples![0], 0.5);
});

test('clipping on an input the recording sums away still shows', () => {
  // Opposite signals cancel in the sum, but the converter saw full scale.
  const { level } = run({ channel: null }, [block(1), block(-1)]);
  assert.equal(level.peak, 1);
});

test('one input of an interface', () => {
  const { level, chunks } = run({ channel: 1 }, [block(0.9), block(0.25)], true);
  assert.equal(level.peak, 0.25);
  assert.equal(chunks[0].samples![0], 0.25);
});

test('stereo interleaves inputs 1 and 2', () => {
  const { level, chunks } = run({ channels: 2 }, [block(0.5), block(-0.25)], true);
  const s = chunks[0].samples!;
  assert.deepEqual([s[0], s[1], s[2], s[3]], [0.5, -0.25, 0.5, -0.25]);
  assert.equal(level.peak, 0.5);
  assert.equal(chunks.reduce((n, c) => n + c.samples!.length, 0), 2 * Math.ceil(1600 / 128) * 128);
});

test('stereo from a mono device puts it on both sides', () => {
  const { chunks } = run({ channels: 2 }, [block(0.3)], true);
  const s = chunks[0].samples!;
  assert.equal(s[0], s[1]);
});

test('each raw input has its own peak', () => {
  const { level } = run({ channel: 0 }, [block(0.5), block(0.125)]);
  assert.deepEqual((level as unknown as { inputs: number[] }).inputs, [0.5, 0.125]);
});
