import { and, eq } from "drizzle-orm";
import { db, assets, shows } from "@podstudio/db";
import { bannerProblem, imageInfo, ARTWORK_MAX_BYTES } from "~/lib/image-info";
import { readCapped, removeImageAsset, storeVerifiedImage } from "~/lib/image-assets.server";
import { artworkFile } from "~/lib/artwork.server";

// Server-only. The wide header image behind the public show page's hero. Optional;
// without it the hero falls back to a soft blurred wash of the show artwork.
export type BannerResult = { ok: true } | { ok: false; error: string; status: number };

export function getShowBanner() {
  return (
    db
      .select({ id: assets.id, key: assets.key, targetId: assets.storageTargetId, bytes: assets.bytes, sha256: assets.sha256, contentType: assets.contentType, meta: assets.meta, slug: shows.slug })
      .from(shows)
      .innerJoin(assets, and(eq(assets.id, shows.bannerAssetId), eq(assets.status, "verified")))
      .get() ?? null
  );
}

export const bannerUrl = (slug: string, a: { sha256: string | null; contentType: string }) => `/${slug}/banner/${artworkFile(a)}`;

export function getBannerAdmin() {
  const b = getShowBanner();
  if (!b) return null;
  const dims = (b.meta ?? {}) as { width?: number; height?: number };
  return { url: bannerUrl(b.slug, b), width: dims.width ?? null, height: dims.height ?? null, bytes: b.bytes, contentType: b.contentType };
}

export async function uploadShowBanner(body: ReadableStream<Uint8Array> | null, declaredLength: number | null): Promise<BannerResult> {
  const show = db.select().from(shows).get();
  if (!show) return { ok: false, error: "No show.", status: 404 };
  if (!body) return { ok: false, error: "No file received.", status: 400 };
  if (declaredLength !== null && declaredLength > ARTWORK_MAX_BYTES) return { ok: false, error: "The image must be under 5 MB.", status: 413 };
  const read = await readCapped(body);
  if (!read.ok) return read;
  const info = imageInfo(read.buf);
  const problem = bannerProblem(info);
  if (problem || !info) return { ok: false, error: problem ?? "Unreadable image.", status: 422 };
  const stored = await storeVerifiedImage({ showId: show.id, kind: "show_banner", keyPrefix: "banner/show", buf: read.buf, info });
  if (!stored.ok) return stored;
  const previous = show.bannerAssetId;
  db.update(shows).set({ bannerAssetId: stored.assetId }).where(eq(shows.id, show.id)).run();
  if (previous) await removeImageAsset(previous).catch(() => {});
  return { ok: true };
}

export async function removeShowBanner() {
  const show = db.select().from(shows).get();
  if (!show?.bannerAssetId) return;
  const id = show.bannerAssetId;
  db.update(shows).set({ bannerAssetId: null }).where(eq(shows.id, show.id)).run();
  await removeImageAsset(id).catch(() => {});
}
