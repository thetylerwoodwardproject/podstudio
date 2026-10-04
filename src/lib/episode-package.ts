import type { EditorProjectV1 } from "./editor-project.ts";

export interface TimedText {
  start: number;
  end: number;
  text: string;
}
export interface Chapter {
  start: number;
  title: string;
}
export interface Soundbite {
  id: string;
  start: number;
  end: number;
  title: string;
  selected: boolean;
}
export interface PackageSource {
  takeId: string;
  audioId: string;
  fingerprint: string;
  revision: number;
  duration: number;
}
export interface EpisodeMaterials {
  title: string;
  description: string;
  chapters: Chapter[];
  transcript: TimedText[];
  soundbites: Soundbite[];
}
export interface EpisodePackageV1 {
  version: 1;
  episodeId: string;
  source: PackageSource | null;
  timingFingerprints: Partial<
    Record<"chapters" | "transcript" | "soundbites", string>
  >;
  materials: EpisodeMaterials;
  materialsFingerprint: string | null;
  suggestions: {
    titles: string[];
    description: string;
    chapters: Chapter[];
    transcript: TimedText[];
    soundbites: Soundbite[];
    fingerprint: string;
  } | null;
}
export type GenerationSection =
  "all" | "transcript" | "title" | "description" | "chapters" | "soundbites";
export interface GenerationJob {
  id: string;
  state:
    | "queued"
    | "transcribing"
    | "writing"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  progress: string;
  error: string | null;
  section: GenerationSection;
}
export const emptyPackage = (episodeId: string): EpisodePackageV1 => ({
  version: 1,
  episodeId,
  source: null,
  timingFingerprints: {},
  materials: {
    title: "",
    description: "",
    chapters: [],
    transcript: [],
    soundbites: [],
  },
  materialsFingerprint: null,
  suggestions: null,
});

/** Only changes audible in a finished mix invalidate timed publishing materials. */
export function audioConfiguration(p: EditorProjectV1) {
  const { mp3: _mp3, rawTracks: _raw, ...master } = p.master;
  return JSON.stringify({
    tracks: p.tracks,
    markers: p.markers,
    sourceMarkers: p.sourceMarkers,
    retakes: p.retakes,
    pauses: p.pauses,
    crossfades: p.crossfades ?? [],
    master,
  });
}
export async function audioFingerprint(p: EditorProjectV1) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(audioConfiguration(p)),
      ),
    ),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
const finite = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;
const text = (s: unknown, max = 10000) =>
  typeof s === "string" && s.length <= max;
export function validMaterials(
  value: unknown,
  duration = Infinity,
): value is EpisodeMaterials {
  if (!value || typeof value !== "object") return false;
  const m = value as EpisodeMaterials;
  return (
    text(m.title, 300) &&
    text(m.description, 30000) &&
    Array.isArray(m.chapters) &&
    m.chapters.length <= 1000 &&
    m.chapters.every(
      (c) => finite(c.start) && c.start <= duration && text(c.title, 300),
    ) &&
    Array.isArray(m.transcript) &&
    m.transcript.length <= 50000 &&
    m.transcript.every(
      (t) =>
        finite(t.start) &&
        finite(t.end) &&
        t.end >= t.start &&
        t.end <= duration + 0.1 &&
        text(t.text),
    ) &&
    Array.isArray(m.soundbites) &&
    m.soundbites.length <= 100 &&
    new Set(m.soundbites.map((s) => s.id)).size === m.soundbites.length &&
    m.soundbites.every(
      (s) =>
        text(s.id, 100) &&
        finite(s.start) &&
        finite(s.end) &&
        s.end > s.start &&
        s.end <= duration + 0.1 &&
        text(s.title, 300) &&
        typeof s.selected === "boolean",
    )
  );
}
export function subtitleTime(seconds: number, separator = ".") {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}${separator}${String(ms % 1000).padStart(3, "0")}`;
}
export function transcriptFiles(transcript: TimedText[]) {
  const cue = (t: TimedText, separator: string) =>
    `${subtitleTime(t.start, separator)} --> ${subtitleTime(t.end, separator)}\n${t.text.replace(/-->/g, "→")}`;
  return {
    txt: transcript.map((t) => t.text).join("\n"),
    srt: transcript.map((t, i) => `${i + 1}\n${cue(t, ",")}\n`).join("\n"),
    vtt: `WEBVTT\n\n${transcript.map((t) => `${cue(t, ".")}\n`).join("\n")}`,
  };
}
