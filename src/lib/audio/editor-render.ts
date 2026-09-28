/* Bounded-window renderer for the Podstudio editor. It reads only clip regions
 * that overlap the requested window; source audio remains immutable. */
import { deleteRange, projectDuration, toneFromFx, type EditorProjectV1, type EditorTrack } from '../editor-project.ts';
import { Leveler } from './loudness.ts';
import { ToneProcessor } from './tone.ts';
import { pcmBytes, wavHeader, type BitDepth } from './wav.ts';

export interface EditorSourceReader {
  channels: 1 | 2;
  sampleRate: number;
  read(from: number, seconds: number): Promise<Float32Array>;
}

export type EditorSources = Map<string, EditorSourceReader>;

const gain = (db: number) => 10 ** (db / 20);

function toStereo(input: Float32Array, channels: number): Float32Array {
  if (channels === 2) return input;
  const out = new Float32Array(input.length * 2);
  for (let i = 0; i < input.length; i++) out[i * 2] = out[i * 2 + 1] = input[i];
  return out;
}

/** Linear resampling is sufficient here because source takes normally share 48 kHz. */
function resample(input: Float32Array, channels: number, from: number, to: number): Float32Array {
  if (from === to) return input;
  const frames = Math.max(0, Math.round((input.length / channels) * to / from));
  const out = new Float32Array(frames * channels);
  for (let frame = 0; frame < frames; frame++) {
    const at = frame * from / to;
    const a = Math.min(Math.max(0, Math.floor(at)), input.length / channels - 1);
    const b = Math.min(a + 1, input.length / channels - 1);
    const f = at - a;
    for (let c = 0; c < channels; c++) out[frame * channels + c] = input[a * channels + c] * (1 - f) + input[b * channels + c] * f;
  }
  return out;
}

export async function renderTrackWindow(track: EditorTrack, sources: EditorSources, from: number, seconds: number, rate = 48000, coughs: [number, number][] = [], leveler?: Leveler): Promise<Float32Array> {
  const frames = Math.max(0, Math.round(seconds * rate));
  const output = new Float32Array(frames * 2);
  if (track.muted) return output;
  const trackGain = gain(track.gainDb);
  for (const clip of track.clips) {
    const clipEnd = clip.timelineStart + clip.sourceEnd - clip.sourceStart;
    const a = Math.max(from, clip.timelineStart);
    const b = Math.min(from + seconds, clipEnd);
    if (b <= a) continue;
    const source = sources.get(clip.sourceId);
    if (!source) continue;
    const sourceFrom = clip.sourceStart + a - clip.timelineStart;
    let samples = await source.read(sourceFrom, b - a);
    samples = resample(samples, source.channels, source.sampleRate, rate);
    if (track.kind === 'voice' && track.fx.noise > 0) samples = await (await import('./denoise.ts')).denoiseSamples(samples, source.channels, rate, track.fx.noise);
    samples = new ToneProcessor(rate, source.channels, toneFromFx(track.fx)).process(samples);
    if (track.kind === 'voice' && track.fx.level) samples = (leveler ?? new Leveler(rate, source.channels)).process(samples);
    const stereo = toStereo(samples, source.channels);
    const startFrame = Math.round((a - from) * rate);
    const fadeIn = Math.round(clip.fadeInMs * rate / 1000);
    const fadeOut = Math.round(clip.fadeOutMs * rate / 1000);
    for (let i = 0; i < stereo.length / 2 && startFrame + i < frames; i++) {
      let envelope = 1;
      if (fadeIn) envelope *= Math.sin(Math.min(1, i / fadeIn) * Math.PI / 2);
      if (fadeOut) envelope *= Math.sin(Math.min(1, (stereo.length / 2 - i) / fadeOut) * Math.PI / 2);
      output[(startFrame + i) * 2] += stereo[i * 2] * trackGain * envelope;
      output[(startFrame + i) * 2 + 1] += stereo[i * 2 + 1] * trackGain * envelope;
    }
  }
  // Cough/mute markers are audible in raw tracks and silent in the cumulative
  // editor/finished mix. Use a 10 ms edge ramp to avoid clicks.
  const ramp = Math.max(1, Math.round(rate * .01));
  for (const [a, b] of coughs) {
    const first = Math.max(0, Math.round((a - from) * rate));
    const last = Math.min(frames, Math.round((b - from) * rate));
    for (let f = first; f < last; f++) {
      const edge = Math.min(1, (f - first) / ramp, (last - f) / ramp);
      const g = 1 - Math.max(0, edge);
      output[f * 2] *= g; output[f * 2 + 1] *= g;
    }
  }
  return output;
}

export async function renderEditorWindow(project: EditorProjectV1, sources: EditorSources, from: number, seconds: number, solo: string[] = [], rate = 48000, levelers?: Map<string, Leveler>): Promise<Float32Array> {
  const n = Math.max(0, Math.round(seconds * rate));
  const mix = new Float32Array(n * 2);
  const tracks = project.tracks.filter((t) => !solo.length || solo.includes(t.id));
  for (const track of tracks) {
    const who = track.role ?? 'host';
    const coughs = track.kind === 'voice' ? project.markers.filter((m) => m.kind === 'cut' && (m.who ?? 'host') === who).map((m) => [m.t, m.end ?? m.t] as [number, number]) : [];
    let leveler = levelers?.get(track.id);
    if (levelers && track.kind === 'voice' && track.fx.level && !leveler) {
      leveler = new Leveler(rate, track.channels);
      levelers.set(track.id, leveler);
    }
    const audio = await renderTrackWindow(track, sources, from, seconds, rate, coughs, leveler);
    for (let i = 0; i < mix.length; i++) mix[i] += audio[i] ?? 0;
  }
  return mix;
}

/** Apply reviewed retakes and pause choices to a disposable render project. */
export function finishedProject(project: EditorProjectV1): EditorProjectV1 {
  let next = structuredClone(project);
  const removals: [number, number][] = [];
  for (const retake of next.retakes) {
    if (!retake.reviewed) continue;
    const selected = retake.attempts.find((a) => a.id === retake.selected);
    if (!selected) continue;
    for (const attempt of retake.attempts) if (attempt.id !== selected.id) removals.push([attempt.start, attempt.end]);
    if (retake.trimStart > selected.start) removals.push([selected.start, retake.trimStart]);
    if (retake.trimEnd < selected.end) removals.push([retake.trimEnd, selected.end]);
  }
  for (const pause of next.pauses) {
    if (pause.action === 'remove') removals.push([pause.start, pause.end]);
    if (pause.action === 'shorten' && pause.end - pause.start > pause.keepSeconds) removals.push([pause.start + pause.keepSeconds, pause.end]);
  }
  for (const [a, b] of removals.sort((x, y) => y[0] - x[0])) next = deleteRange(next, a, b, true);
  // All edit joins get a short equal-power fade.
  for (const track of next.tracks) for (const clip of track.clips) {
    clip.fadeInMs = Math.max(clip.fadeInMs, 10);
    clip.fadeOutMs = Math.max(clip.fadeOutMs, 10);
  }
  return next;
}

export async function renderProjectWav(
  project: EditorProjectV1,
  sources: EditorSources,
  onProgress?: (done: number) => void,
  options: { finished?: boolean; rate?: number; bitDepth?: BitDepth } = {},
): Promise<Blob> {
  const rate = options.rate ?? 48000;
  const bitDepth = options.bitDepth ?? 24;
  const rendering = options.finished === false ? project : finishedProject(project);
  const duration = projectDuration(rendering);
  const step = 10;
  const chunks: Uint8Array[] = [];
  const levelers = new Map<string, Leveler>();
  let frames = 0;
  for (let from = 0; from < duration; from += step) {
    const seconds = Math.min(step, duration - from);
    const mix = await renderEditorWindow(rendering, sources, from, seconds, [], rate, levelers);
    chunks.push(pcmBytes(mix, bitDepth));
    frames += mix.length / 2;
    onProgress?.(Math.min(1, (from + seconds) / Math.max(.001, duration)));
  }
  return new Blob([wavHeader(frames, { sampleRate: rate, channels: 2, bitDepth }) as BlobPart, ...(chunks as BlobPart[])], { type: 'audio/wav' });
}
