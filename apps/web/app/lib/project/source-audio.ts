import { pcm24ToFloat } from "~/lib/capture-contract";

const WAV_HEADER = 44;

/** A stretch of a recording's samples (24-bit WAV → Float32) by HTTP Range; never the whole file. */
export async function fetchSamples(assetId: string, totalSamples: number, from: number, count: number): Promise<Float32Array> {
  const a = Math.max(0, from);
  const b = Math.min(totalSamples, from + count);
  if (b <= a) return new Float32Array(0);
  const res = await fetch(`/studio/assets/${assetId}/audio`, { headers: { Range: `bytes=${WAV_HEADER + a * 3}-${WAV_HEADER + b * 3 - 1}` } });
  if (res.status !== 206 && res.status !== 200) throw new Error(`audio ${res.status}`);
  return pcm24ToFloat(new Uint8Array(await res.arrayBuffer()));
}
