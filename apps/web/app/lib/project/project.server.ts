import { deleteRecording } from "~/lib/recordings.server";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, assets, episodes, projectRevisions, projects, recordings } from "@podstudio/db";
import { isLibraryAsset } from "~/lib/library.server";
import { PROJECT_SCHEMA_VERSION, createProject, parseProject, timeMap, type ProjectDoc } from "~/lib/project/document";
import type { RetakeAnnotation } from "~/lib/capture-contract";

// Server-only. The editing project for an episode: the versioned document, appended as an
// immutable revision on every save. A save names the revision it was based on; if someone
// else (another tab, another device) saved since, it is refused with the current revision so
// the browser can show the conflict instead of silently overwriting edits.

export interface LoadedProject {
  projectId: string;
  revisionId: string;
  seq: number;
  doc: ProjectDoc;
  updatedAt: number;
}

type Fail = { ok: false; error: string; status: number };
export type SaveResult = { ok: true; revisionId: string; seq: number; updatedAt: number } | Fail | { ok: false; conflict: true; status: 409; current: LoadedProject };

export function loadProject(episodeId: string): LoadedProject | null {
  const p = db.select().from(projects).where(eq(projects.episodeId, episodeId)).get();
  if (!p?.currentRevisionId) return null;
  const rev = db.select().from(projectRevisions).where(eq(projectRevisions.id, p.currentRevisionId)).get();
  if (!rev) return null;
  const parsed = parseProject(rev.document);
  if (!parsed.ok) return null;
  return { projectId: p.id, revisionId: rev.id, seq: rev.seq, doc: parsed.doc, updatedAt: rev.createdAt };
}

/** Recordings that can seed a project: finished, with a verified WAV. */
export function listEditableRecordings(episodeId: string) {
  return db
    .select({ id: recordings.id, status: recordings.status, totalSamples: recordings.totalSamples, sampleRate: recordings.sampleRate, startedAt: recordings.startedAt, assetId: recordings.finalAssetId })
    .from(recordings)
    .innerJoin(assets, and(eq(assets.id, recordings.finalAssetId), eq(assets.status, "verified")))
    .where(eq(recordings.episodeId, episodeId))
    .orderBy(desc(recordings.startedAt))
    .all();
}

function insertRevision(projectId: string, parentId: string | null, seq: number, doc: ProjectDoc, label: string | null) {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.insert(projectRevisions).values({ id, projectId, parentId, seq, document: doc, timeMap: timeMap(doc), label, createdAt: now }).run();
  return { id, now };
}

/** Start the episode's project from a finished recording. Returns the existing project if there is one. */
export function startProject(episodeId: string, recordingId: string): { ok: true; project: LoadedProject } | Fail {
  const existing = loadProject(episodeId);
  if (existing) return { ok: true, project: existing };
  const ep = db.select({ id: episodes.id }).from(episodes).where(eq(episodes.id, episodeId)).get();
  if (!ep) return { ok: false, error: "Episode not found.", status: 404 };
  const rec = db.select().from(recordings).where(and(eq(recordings.id, recordingId), eq(recordings.episodeId, episodeId))).get();
  if (!rec?.finalAssetId || !rec.totalSamples) return { ok: false, error: "That recording isn't finished yet.", status: 409 };
  const asset = db.select().from(assets).where(and(eq(assets.id, rec.finalAssetId), eq(assets.status, "verified"))).get();
  if (!asset) return { ok: false, error: "The recording's audio isn't verified.", status: 409 };
  const retakes = ((rec.annotations as RetakeAnnotation[] | null) ?? []).filter((a) => a?.type === "retake" && Number.isInteger(a.sample)).map((a) => a.sample);
  const doc = createProject({
    sampleRate: rec.sampleRate,
    source: { id: crypto.randomUUID(), assetId: asset.id, recordingId: rec.id, label: `Recording ${new Date(rec.startedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`, totalSamples: rec.totalSamples, retakes },
  });
  const projectId = crypto.randomUUID();
  try {
    db.transaction((tx) => {
      tx.insert(projects).values({ id: projectId, episodeId, schemaVersion: PROJECT_SCHEMA_VERSION, currentRevisionId: null, createdAt: Date.now() }).run();
      const rev = insertRevision(projectId, null, 1, doc, "Created from recording");
      tx.update(projects).set({ currentRevisionId: rev.id }).where(eq(projects.id, projectId)).run();
    });
  } catch {
    const again = loadProject(episodeId); // lost a race with another tab: use theirs
    if (again) return { ok: true, project: again };
    return { ok: false, error: "Couldn't create the project.", status: 500 };
  }
  return { ok: true, project: loadProject(episodeId)! };
}

/** Every source must be a verified private WAV of this episode, long enough for what the clips use. */
function checkSources(episodeId: string, doc: ProjectDoc): string | null {
  for (const s of doc.sources) {
    const a = db.select().from(assets).where(eq(assets.id, s.assetId)).get();
    const mine = !!a && (a.episodeId === episodeId || (a.episodeId === null && isLibraryAsset(a.id, a.showId)));
    if (!a || a.status !== "verified" || !mine || a.kind !== "raw_audio") return `Source "${s.label}" isn't a verified recording of this episode.`;
    const samples = (a.meta as { samples?: number } | null)?.samples;
    if (typeof samples !== "number" || s.totalSamples !== samples) return `Source "${s.label}" has the wrong length.`;
    if (a.sampleRate !== doc.sampleRate) return `Source "${s.label}" isn't at the project sample rate.`;
  }
  return null;
}

export function saveProject(episodeId: string, baseRevisionId: string, raw: unknown, label?: string | null): SaveResult {
  const parsed = parseProject(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 422 };
  const problem = checkSources(episodeId, parsed.doc);
  if (problem) return { ok: false, error: problem, status: 422 };
  const p = db.select().from(projects).where(eq(projects.episodeId, episodeId)).get();
  if (!p) return { ok: false, error: "No project for this episode.", status: 404 };
  // Short write transaction: re-check the head inside it so two saves can't both win.
  return db.transaction((tx) => {
    const head = tx.select().from(projects).where(eq(projects.id, p.id)).get()!;
    if (head.currentRevisionId !== baseRevisionId) {
      return { ok: false as const, conflict: true as const, status: 409 as const, current: loadProject(episodeId)! };
    }
    const last = tx.select({ seq: sql<number>`max(${projectRevisions.seq})` }).from(projectRevisions).where(eq(projectRevisions.projectId, p.id)).get();
    const seq = (last?.seq ?? 0) + 1;
    const rev = insertRevision(p.id, baseRevisionId, seq, parsed.doc, label ?? null);
    tx.update(projects).set({ currentRevisionId: rev.id }).where(eq(projects.id, p.id)).run();
    return { ok: true as const, revisionId: rev.id, seq, updatedAt: rev.now };
  });
}

export function projectUsesRecording(recordingId: string): boolean {
  const rec = db.select({ episodeId: recordings.episodeId }).from(recordings).where(eq(recordings.id, recordingId)).get();
  const cur = rec && loadProject(rec.episodeId);
  return !!cur?.doc.sources.some((s) => s.recordingId === recordingId);
}

/** Sources whose audio is gone (deleted or never verified): the editor plays around them and offers to remove their clips. */
export function missingSources(doc: ProjectDoc): { id: string; label: string; clips: number }[] {
  return doc.sources
    .filter((s) => {
      const a = db.select({ status: assets.status }).from(assets).where(eq(assets.id, s.assetId)).get();
      return !a || a.status !== "verified";
    })
    .map((s) => ({ id: s.id, label: s.label, clips: doc.clips.filter((c) => c.sourceId === s.id).length }));
}

/** Delete a take unless the episode's edit project still uses it (that would leave clips with no audio). */
export async function deleteRecordingIfUnused(recordingId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (projectUsesRecording(recordingId)) return { ok: false, error: "This take is used in the episode's edit project. Remove its clips in the editor first." };
  await deleteRecording(recordingId);
  return { ok: true };
}

export function deleteProjectForEpisode(episodeId: string) {
  const p = db.select({ id: projects.id }).from(projects).where(eq(projects.episodeId, episodeId)).get();
  if (!p) return;
  db.transaction((tx) => {
    tx.update(projects).set({ currentRevisionId: null }).where(eq(projects.id, p.id)).run();
    tx.delete(projectRevisions).where(eq(projectRevisions.projectId, p.id)).run();
    tx.delete(projects).where(eq(projects.id, p.id)).run();
  });
}
