/* Bounded-window renderer for the Podstudio editor. It reads only clip regions
 * that overlap the requested window; source audio remains immutable. */
import { deleteRange, projectDuration, toneFromFx, type EditorCrossfade, type EditorProjectV1, type EditorTrack } from '../editor-project.ts';
import { crossfadeSpan } from '../editor-crossfades.ts';
import { Leveler } from './loudness.ts';
import { ToneProcessor } from './tone.ts';
import { pcmBytes, wavHeader, type BitDepth } from './wav.ts';

export interface EditorSourceReader {
  channels: 1 | 2;
  sampleRate: number;
  read(from: number, seconds: number): Promise<Float32Array>;
}

export type EditorSources = Map<string, EditorSourceReader>;

export interface RenderState { processors: Map<string, { end: number; tone: ToneProcessor; leveler: Leveler }> }
export const createRenderState = (): RenderState => ({ processors: new Map() });

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

export async function renderTrackWindow(track: EditorTrack, sources: EditorSources, from: number, seconds: number, rate = 48000, coughs: [number, number][] = [], leveler?: Leveler, state?: RenderState, sourceCoughs?: [number, number][], crossfades: EditorCrossfade[] = []): Promise<Float32Array> {
  const frames = Math.max(0, Math.round(seconds * rate));
  const output = new Float32Array(frames * 2);
  if (track.muted) return output;
  const trackGain = gain(track.gainDb);
  const envelopes = new Map<string, { start: number; end: number; outgoing: boolean }[]>();
  for (const fade of crossfades) {
    const span = crossfadeSpan(track, fade); if (!span) continue;
    for (const [ids, outgoing] of [[fade.from, true], [fade.to, false]] as const) for (const id of ids) {
      const values = envelopes.get(id) ?? []; values.push({ start: span[0], end: span[1], outgoing }); envelopes.set(id, values);
    }
  }
  for (const clip of track.clips) {
    const clipEnd = clip.timelineStart + clip.sourceEnd - clip.sourceStart;
    const a = Math.max(from, clip.timelineStart);
    const b = Math.min(from + seconds, clipEnd);
    if (b <= a) continue;
    const source = sources.get(clip.sourceId);
    if (!source) continue;
    const sourceFrom = clip.sourceStart + a - clip.timelineStart;
    let samples = await source.read(sourceFrom, b - a);
    samples = resample(samples, source.channels, source.sampleRate, rate).slice();
    if (track.kind === 'voice' && track.fx.noise > 0) samples = await (await import('./denoise.ts')).denoiseSamples(samples, source.channels, rate, track.fx.noise);
    const key = `${track.id}:${clip.id}:${rate}:${JSON.stringify(track.fx)}`;
    let processor = state?.processors.get(key);
    if (!processor || Math.abs(processor.end - a) > 1 / rate) processor = { end: a, tone: new ToneProcessor(rate, source.channels, toneFromFx(track.fx)), leveler: new Leveler(rate, source.channels) };
    samples = processor.tone.process(samples);
    if (track.kind === 'voice' && track.fx.level) samples = (leveler ?? processor.leveler).process(samples);
    processor.end = b;
    state?.processors.set(key, processor);
    if (sourceCoughs) for (let i = 0; i < samples.length / source.channels; i++) {
      const time = sourceFrom + i / rate;
      for (const [start, end] of sourceCoughs) if (time >= start && time < end) {
        const g = 1 - Math.min(1, (time - start) / .01, (end - time) / .01);
        for (let c = 0; c < source.channels; c++) samples[i * source.channels + c] *= g;
      }
    }
    const stereo = toStereo(samples, source.channels);
    const startFrame = Math.round((a - from) * rate);
    const fades = envelopes.get(clip.id) ?? [];
    const fadeIn = Math.round(clip.fadeInMs * rate / 1000);
    const fadeOut = Math.round(clip.fadeOutMs * rate / 1000);
    for (let i = 0; i < stereo.length / 2 && startFrame + i < frames; i++) {
      let envelope = 1;
      for (const fade of fades) {
        const p = Math.max(0, Math.min(1, (a + i / rate - fade.start) / (fade.end - fade.start)));
        envelope *= fade.outgoing ? Math.cos(p * Math.PI / 2) : Math.sin(p * Math.PI / 2);
      }
      if (fadeIn) envelope *= Math.sin(Math.min(1, ((a - clip.timelineStart) * rate + i) / fadeIn) * Math.PI / 2);
      if (fadeOut) envelope *= Math.sin(Math.min(1, ((clipEnd - a) * rate - i) / fadeOut) * Math.PI / 2);
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

export async function renderEditorWindow(project: EditorProjectV1, sources: EditorSources, from: number, seconds: number, solo: string[] = [], rate = 48000, levelers?: Map<string, Leveler>, state?: RenderState): Promise<Float32Array> {
  const n = Math.max(0, Math.round(seconds * rate));
  const mix = new Float32Array(n * 2);
  const tracks = project.tracks.filter((t) => !solo.length || solo.includes(t.id));
  for (const track of tracks) {
    const who = track.role ?? 'host';
    const coughs = track.kind === 'voice' && !project.sourceMarkers ? project.markers.filter((m) => m.kind === 'cut' && (m.who ?? 'host') === who).map((m) => [m.t, m.end ?? m.t] as [number, number]) : [];
    let leveler = levelers?.get(track.id);
    if (levelers && track.kind === 'voice' && track.fx.level && !leveler) {
      leveler = new Leveler(rate, track.channels);
      levelers.set(track.id, leveler);
    }
    const audio = await renderTrackWindow(track, sources, from, seconds, rate, coughs, leveler, state, track.kind === 'voice' ? project.sourceMarkers?.filter((m) => m.kind === 'cut' && (m.who ?? 'host') === who).map((m) => [m.t, m.end ?? m.t]) : undefined, (project.crossfades ?? []).filter((f) => f.trackId === track.id));
    for (let i = 0; i < mix.length; i++) mix[i] += audio[i] ?? 0;
  }
  return mix;
}

/** Apply reviewed retakes and pause choices to a disposable render project. */
export function finishedProject(project: EditorProjectV1): EditorProjectV1 {
  let next = structuredClone(project);
  const removals: [number, number][] = [];
  const rejectedSource: [number, number][] = [];
  for (const retake of next.retakes) {
    if (!retake.reviewed) continue;
    const selected = retake.attempts.find((a) => a.id === retake.selected);
    if (!selected) continue;
    for (const attempt of retake.attempts) if (attempt.id !== selected.id) rejectedSource.push([attempt.start, attempt.end]);
    if (retake.trimStart > selected.start) rejectedSource.push([selected.start, retake.trimStart]);
    if (retake.trimEnd < selected.end) rejectedSource.push([retake.trimEnd, selected.end]);
  }
  const host = next.tracks.find((t) => t.kind === 'voice' && (t.role ?? 'host') === 'host');
  for (const [a, b] of rejectedSource) {
    if (!next.sourceMarkers || !host) { removals.push([a, b]); continue; }
    for (const clip of host.clips) {
      const start = Math.max(a, clip.sourceStart), end = Math.min(b, clip.sourceEnd);
      if (end > start) removals.push([clip.timelineStart + start - clip.sourceStart, clip.timelineStart + end - clip.sourceStart]);
    }
  }
  for (const pause of next.pauses) {
    if (pause.action === 'remove') removals.push([pause.start, pause.end]);
    if (pause.action === 'shorten' && pause.end - pause.start > pause.keepSeconds) removals.push([pause.start + pause.keepSeconds, pause.end]);
  }
  const merged: [number, number][] = [];
  for (const [a, b] of removals.sort((x, y) => x[0] - y[0])) {
    const last = merged.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else merged.push([a, b]);
  }
  for (const [a, b] of merged.reverse()) next = deleteRange(next, a, b, true);
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
  options: { finished?: boolean; rate?: number; bitDepth?: BitDepth; signal?: AbortSignal } = {},
): Promise<Blob> {
  const rate = options.rate ?? 48000;
  const bitDepth = options.bitDepth ?? 24;
  const rendering = options.finished === false ? project : finishedProject(project);
  const duration = projectDuration(rendering);
  const step = 10;
  const chunks: Uint8Array[] = [];
  const state = createRenderState();
  let frames = 0;
  for (let from = 0; from < duration; from += step) {
    options.signal?.throwIfAborted();
    const seconds = Math.min(step, duration - from);
    const mix = await renderEditorWindow(rendering, sources, from, seconds, [], rate, undefined, state);
    chunks.push(pcmBytes(mix, bitDepth));
    frames += mix.length / 2;
    onProgress?.(Math.min(1, (from + seconds) / Math.max(.001, duration)));
  }
  return new Blob([wavHeader(frames, { sampleRate: rate, channels: 2, bitDepth }) as BlobPart, ...(chunks as BlobPart[])], { type: 'audio/wav' });
}
