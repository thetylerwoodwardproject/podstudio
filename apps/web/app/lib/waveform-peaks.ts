// Pure: the public waveform's bar levels from per-block sample peaks (shared by server and tests).

/** Reduce absolute sample peaks per block to `bars` levels, normalized to the loudest. */
export function reducePeaks(blocks: Float32Array, bars: number): number[] {
  const out = new Array<number>(bars).fill(0);
  if (blocks.length === 0) return out;
  for (let i = 0; i < bars; i++) {
    const a = Math.floor((i * blocks.length) / bars);
    const b = Math.max(a + 1, Math.floor(((i + 1) * blocks.length) / bars));
    let m = 0;
    for (let j = a; j < b && j < blocks.length; j++) if (blocks[j]! > m) m = blocks[j]!;
    out[i] = m;
  }
  const top = Math.max(...out);
  return out.map((v) => (top > 0 ? Math.round((v / top) * 1000) / 1000 : 0));
}

