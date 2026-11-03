import { and, asc, eq } from "drizzle-orm";
import { assets, db, libraryItems, projectRevisions, projects, shows } from "@podstudio/db";
import { deleteAssetAndObject, storeOriginal } from "~/lib/project/imports.server";

// Server-only. The show's library of commonly used audio. An upload is stored as-is, converted
// by the worker to the project format, and then any episode can place it on a track.

type Fail = { ok: false; error: string; status: number };
export type LibraryKind = "music" | "sfx";

const firstShow = () => db.select({ id: shows.id }).from(shows).limit(1).get();

export function listLibrary() {
  const show = firstShow();
  if (!show) return [];
  return db
    .select({ id: libraryItems.id, name: libraryItems.name, kind: libraryItems.kind, status: libraryItems.status, progress: libraryItems.progress, filename: libraryItems.filename, assetId: libraryItems.assetId, durationS: libraryItems.durationS, error: libraryItems.error, cancelRequested: libraryItems.cancelRequested, createdAt: libraryItems.createdAt })
    .from(libraryItems)
    .where(eq(libraryItems.showId, show.id))
    .orderBy(asc(libraryItems.name))
    .all()
    .map((i) => ({ ...i, channels: i.assetId ? assetChannels(i.assetId) : 1, usedIn: i.assetId ? episodesUsing(i.assetId).length : 0 }));
}

export async function createLibraryItem(input: { filename: string; name: string | null; kind: unknown; contentLength: number | null; body: ReadableStream<Uint8Array> | null }): Promise<{ ok: true; id: string } | Fail> {
  const show = firstShow();
  if (!show) return { ok: false, error: "No show.", status: 404 };
  const kind: LibraryKind = input.kind === "sfx" ? "sfx" : "music";
  const id = crypto.randomUUID();
  const stored = await storeOriginal({ showId: show.id, episodeId: null, filename: input.filename, contentLength: input.contentLength, body: input.body, keyPrefix: `library/${show.id}/${id}` });
  if (!stored.ok) return stored;
  const name = (input.name?.trim() || stored.filename.replace(/\.[^.]+$/, "")).slice(0, 80) || "Untitled";
  db.insert(libraryItems).values({ id, showId: show.id, name, kind, status: "queued", progress: 0, filename: stored.filename, originalAssetId: stored.assetId, createdAt: Date.now() }).run();
  return { ok: true, id };
}

export function updateLibraryItem(id: string, patch: { name?: unknown; kind?: unknown }): { ok: true } | Fail {
  const cur = db.select().from(libraryItems).where(eq(libraryItems.id, id)).get();
  if (!cur) return { ok: false, error: "Not found.", status: 404 };
  const set: Partial<typeof libraryItems.$inferInsert> = {};
  if (patch.name !== undefined) {
    const n = typeof patch.name === "string" ? patch.name.trim() : "";
    if (!n || n.length > 80) return { ok: false, error: "A name is 1–80 characters.", status: 422 };
    set.name = n;
  }
  if (patch.kind !== undefined) {
    if (patch.kind !== "music" && patch.kind !== "sfx") return { ok: false, error: "Kind is music or sfx.", status: 422 };
    set.kind = patch.kind;
  }
  if (Object.keys(set).length) db.update(libraryItems).set(set).where(eq(libraryItems.id, id)).run();
  return { ok: true };
}

/** Episodes whose current project uses this decoded asset. */
/** 1 or 2: how many channels a decoded library asset has. */
function assetChannels(assetId: string): 1 | 2 {
  return db.select({ c: assets.channels }).from(assets).where(eq(assets.id, assetId)).get()?.c === 2 ? 2 : 1;
}

export function episodesUsing(assetId: string): string[] {
  const out: string[] = [];
  for (const p of db.select().from(projects).all()) {
    if (!p.currentRevisionId) continue;
    const rev = db.select({ doc: projectRevisions.document }).from(projectRevisions).where(eq(projectRevisions.id, p.currentRevisionId)).get();
    const doc = rev?.doc as { sources?: { assetId?: string }[] } | undefined;
    if (doc?.sources?.some((s) => s.assetId === assetId)) out.push(p.episodeId);
  }
  return out;
}

export async function deleteLibraryItem(id: string): Promise<{ ok: true; action: "cancelling" | "deleted" } | Fail> {
  const item = db.select().from(libraryItems).where(eq(libraryItems.id, id)).get();
  if (!item) return { ok: false, error: "Not found.", status: 404 };
  if (item.status === "running") {
    db.update(libraryItems).set({ cancelRequested: 1 }).where(eq(libraryItems.id, id)).run();
    return { ok: true, action: "cancelling" };
  }
  if (item.assetId) {
    const used = episodesUsing(item.assetId);
    if (used.length) return { ok: false, error: `This is used in ${used.length} episode${used.length === 1 ? "" : "s"}. Remove it from ${used.length === 1 ? "that episode" : "those episodes"} first.`, status: 409 };
  }
  const { assetId, originalAssetId } = item;
  db.delete(libraryItems).where(eq(libraryItems.id, id)).run();
  await deleteAssetAndObject(assetId);
  await deleteAssetAndObject(originalAssetId);
  return { ok: true, action: "deleted" };
}

/** Is this asset a ready library item (so any project of the show may use it)? */
export function isLibraryAsset(assetId: string, showId: string): boolean {
  return !!db.select({ id: libraryItems.id }).from(libraryItems).where(and(eq(libraryItems.assetId, assetId), eq(libraryItems.showId, showId), eq(libraryItems.status, "ready"))).get();
}
