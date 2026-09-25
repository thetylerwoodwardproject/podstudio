/*
 * The Pads track and the rough mix, rendered at export into processed copies
 * beside the take (`takes/<id>/pads/`, `takes/<id>/mix/`), stereo, in the
 * take's own rate and bit depth. From there they're cut like any other track.
 */
import { loadPadSettings, readLibraryFile } from '../pads';
import { PadRenderer, roughMix, type PadAudio } from './pads-render';
import { VariantWriter, hasVariant, readFrames, type TakeMeta } from './takes';

const CHUNK_SECONDS = 5;

/** The take as its stereo Pads track (or rough mix), for rangesWav/takeWav with that variant. */
export const stereoOf = (take: TakeMeta): TakeMeta => ({ ...take, channels: 2 });
export const hasPads = (take: TakeMeta) => !!take.pads?.presses.length;

function mono(x: Float32Array, channels: number) {
  if (channels === 1) return x;
  const out = new Float32Array(x.length / channels);
  for (let f = 0; f < out.length; f++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += x[f * channels + c];
    out[f] = s / channels;
  }
  return out;
}

/** Render the Pads track once (kept for next time). Sounds missing from this browser come out silent. */
export async function renderPads(take: TakeMeta, onProgress?: (done: number) => void): Promise<'pads'> {
  if (await hasVariant(take, 'pads')) return 'pads';
  const log = take.pads!;
  const audio = new Map<string, PadAudio>();
  for (const id of new Set(log.presses.map((p) => p.fileId))) {
    try {
      audio.set(id, { rate: 48000, data: await readLibraryFile(id) });
    } catch {}
  }
  const s = loadPadSettings();
  const duck = log.duck ?? { attackMs: s.duckAttackMs, releaseMs: s.duckReleaseMs, threshold: s.threshold };
  const renderer = new PadRenderer(log, audio, take.sampleRate, take.markers ?? [], duck);
  const out = await VariantWriter.open(take, 'pads');
  const chunk = CHUNK_SECONDS * take.sampleRate;
  const ch = take.channels ?? 1;
  for (let from = 0; from < take.samples; from += chunk) {
    const n = Math.min(chunk, take.samples - from);
    await out.write(renderer.render(mono(await readFrames(take, from, n), ch)));
    onProgress?.(Math.min(1, (from + n) / take.samples));
  }
  await out.done();
  return 'pads';
}

/** Mic plus pads in one stereo file, limited to -1 dBFS. */
export async function renderRoughMix(take: TakeMeta, onProgress?: (done: number) => void): Promise<'mix'> {
  await renderPads(take);
  const out = await VariantWriter.open(take, 'mix');
  const chunk = CHUNK_SECONDS * take.sampleRate;
  const ch = take.channels ?? 1;
  const state = { g: 1 };
  for (let from = 0; from < take.samples; from += chunk) {
    const n = Math.min(chunk, take.samples - from);
    const mic = await readFrames(take, from, n);
    const pads = await readFrames(stereoOf(take), from, n, 'pads');
    await out.write(roughMix(mic, ch, pads, state, take.sampleRate));
    onProgress?.(Math.min(1, (from + n) / take.samples));
  }
  await out.done();
  return 'mix';
}
