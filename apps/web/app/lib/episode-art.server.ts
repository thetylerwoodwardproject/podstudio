import { and, eq, inArray } from "drizzle-orm";
import { db, assets, episodes, shows } from "@podstudio/db";
import { artworkProblem, imageInfo, ARTWORK_MAX_BYTES } from "~/lib/image-info";
import { readCapped, removeImageAsset, storeVerifiedImage, type ServableImage } from "~/lib/image-assets.server";
import { artworkFile } from "~/lib/artwork.server";

// Server-only. Optional cover art for one episode (same rules as the show artwork:
// PNG/JPEG, square, 1400–3000 px). Where an episode has none, every page, the player,
// the embed and the feed fall back to the show artwork. Public serving is limited to
// published + public episodes, like their audio.

export type EpisodeArtResult = { ok: true } | { ok: false; error: string; status: number };

export function episodeArtUrl(slug: string, publicId: string, a: { sha256: string | null; contentType: string }) {
  return `/${slug}/episode-art/${publicId}/${artworkFile(a)}`;
}

function artAsset(episodeId: string) {
  return (
    db
      .select({ id: assets.id, key: assets.key, targetId: assets.storageTargetId, bytes: assets.bytes, sha256: assets.sha256, contentType: assets.contentType, meta: assets.meta })
      .from(episodes)
      .innerJoin(assets, and(eq(assets.id, episodes.artworkAssetId), eq(assets.status, "verified")))
      .where(eq(episodes.id, episodeId))
      .get() ?? null
  );
}

/** For the studio's episode page. */
export function getEpisodeArtAdmin(episodeId: string) {
  const ep = db.select({ publicId: episodes.publicId, showId: episodes.showId }).from(episodes).where(eq(episodes.id, episodeId)).get();
  const show = ep && db.select({ slug: shows.slug }).from(shows).where(eq(shows.id, ep.showId)).get();
  const a = artAsset(episodeId);
  if (!ep || !show || !a) return null;
  const dims = (a.meta ?? {}) as { width?: number; height?: number };
  return { url: episodeArtUrl(show.slug, ep.publicId, a), width: dims.width ?? null, height: dims.height ?? null, bytes: a.bytes, contentType: a.contentType };
}

export async function uploadEpisodeArtwork(episodeId: string, body: ReadableStream<Uint8Array> | null, declaredLength: number | null): Promise<EpisodeArtResult> {
  const ep = db.select().from(episodes).where(eq(episodes.id, episodeId)).get();
  if (!ep) return { ok: false, error: "Episode not found.", status: 404 };
  if (!body) return { ok: false, error: "No file received.", status: 400 };
  if (declaredLength !== null && declaredLength > ARTWORK_MAX_BYTES) return { ok: false, error: "The artwork must be under 5 MB.", status: 413 };
  const read = await readCapped(body);
  if (!read.ok) return read;
  const info = imageInfo(read.buf);
  const problem = artworkProblem(info);
  if (problem || !info) return { ok: false, error: problem ?? "Unreadable image.", status: 422 };

  const stored = await storeVerifiedImage({ showId: ep.showId, episodeId, kind: "episode_artwork", keyPrefix: `artwork/episode/${ep.publicId}`, buf: read.buf, info });
  if (!stored.ok) return stored;
  const previous = ep.artworkAssetId;
  db.update(episodes).set({ artworkAssetId: stored.assetId, updatedAt: Date.now() }).where(eq(episodes.id, episodeId)).run();
  if (previous) await removeImageAsset(previous).catch(() => {});
  return { ok: true };
}

export async function removeEpisodeArtwork(episodeId: string) {
  const ep = db.select({ artworkAssetId: episodes.artworkAssetId }).from(episodes).where(eq(episodes.id, episodeId)).get();
  if (!ep?.artworkAssetId) return;
  db.update(episodes).set({ artworkAssetId: null, updatedAt: Date.now() }).where(eq(episodes.id, episodeId)).run();
  await removeImageAsset(ep.artworkAssetId).catch(() => {});
}

/** The cover for a public episode URL; null unless the episode is published + public and has its own art. */
export function findPublicEpisodeArt(slug: string, publicId: string): (ServableImage & { id: string }) | null {
  const row = db
    .select({ id: assets.id, key: assets.key, targetId: assets.storageTargetId, bytes: assets.bytes, sha256: assets.sha256, contentType: assets.contentType })
    .from(shows)
    .innerJoin(episodes, eq(episodes.showId, shows.id))
    .innerJoin(assets, and(eq(assets.id, episodes.artworkAssetId), eq(assets.status, "verified")))
    .where(and(eq(shows.slug, slug), eq(episodes.publicId, publicId), eq(episodes.status, "published"), eq(episodes.visibility, "public")))
    .get();
  return row ?? null;
}

/** Cover URLs for a set of episodes (keyed by episode id) — only those that have their own art. */
export function episodeArtUrlsFor(slug: string, rows: { id: string; publicId: string }[]) {
  const out = new Map<string, string>();
  if (rows.length === 0) return out;
  const found = db
    .select({ id: episodes.id, publicId: episodes.publicId, sha256: assets.sha256, contentType: assets.contentType })
    .from(episodes)
    .innerJoin(assets, and(eq(assets.id, episodes.artworkAssetId), eq(assets.status, "verified")))
    .where(inArray(episodes.id, rows.map((r) => r.id)))
    .all();
  for (const f of found) out.set(f.id, episodeArtUrl(slug, f.publicId, f));
  return out;
}
