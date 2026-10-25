import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { db, assets, episodes, episodePeople, people, shows, storageTargets } from "@podstudio/db";
import { avatarProblem, imageInfo, ARTWORK_MAX_BYTES } from "~/lib/image-info";
import { clientFor, routedTarget } from "~/lib/media.server";
import { slugify } from "~/lib/episode-fields";

// Server-only. "Hosts & guests": the public profile of everyone credited on the
// show — bio, website, headshot. The headshot goes to the public feedMedia target
// like the show artwork and is only believed after read-back (size + hash).
// Who may appear publicly: hosts, and guests credited on at least one *public
// published* episode — a guest who only appears on drafts is never exposed.

export const PERSON_ROLES = ["host", "guest"] as const;
const EXT = { png: "png", jpeg: "jpg" } as const;
const TYPE = { png: "image/png", jpeg: "image/jpeg" } as const;

export function avatarFile(a: { sha256: string | null; contentType: string }) {
  return `${(a.sha256 ?? "").slice(0, 12)}.${a.contentType === "image/png" ? "png" : "jpg"}`;
}

export function avatarUrl(slug: string, personId: string, a: { sha256: string | null; contentType: string } | null | undefined) {
  return a ? `/${slug}/avatar/${personId}/${avatarFile(a)}` : null;
}

const avatarCols = { sha256: assets.sha256, contentType: assets.contentType };

function avatarAsset(personId: string) {
  return (
    db
      .select({ id: assets.id, key: assets.key, targetId: assets.storageTargetId, bytes: assets.bytes, sha256: assets.sha256, contentType: assets.contentType })
      .from(people)
      .innerJoin(assets, and(eq(assets.id, people.avatarAssetId), eq(assets.status, "verified")))
      .where(eq(people.id, personId))
      .get() ?? null
  );
}

export function listPeopleAdmin() {
  const show = db.select({ id: shows.id, slug: shows.slug }).from(shows).get();
  if (!show) return null;
  const rows = db.select().from(people).where(eq(people.showId, show.id)).orderBy(asc(people.name)).all();
  const credited = db
    .select({ personId: episodePeople.personId, n: sql<number>`count(distinct ${episodePeople.episodeId})` })
    .from(episodePeople)
    .groupBy(episodePeople.personId)
    .all();
  const publicCredited = new Set(
    db
      .select({ personId: episodePeople.personId })
      .from(episodePeople)
      .innerJoin(episodes, eq(episodes.id, episodePeople.episodeId))
      .where(and(eq(episodes.status, "published"), eq(episodes.visibility, "public")))
      .all()
      .map((r) => r.personId),
  );
  return {
    slug: show.slug,
    people: rows.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      episodes: credited.find((c) => c.personId === p.id)?.n ?? 0,
      onPublicSite: p.role === "host" || publicCredited.has(p.id),
      avatarUrl: avatarUrl(show.slug, p.id, avatarAsset(p.id)),
    })),
  };
}

export function getPersonAdmin(id: string) {
  const show = db.select({ id: shows.id, slug: shows.slug }).from(shows).get();
  const p = db.select().from(people).where(eq(people.id, id)).get();
  if (!show || !p || p.showId !== show.id) return null;
  const a = avatarAsset(id);
  const credits = db
    .select({ episodeId: episodes.id, title: episodes.title, number: episodes.number, status: episodes.status, visibility: episodes.visibility, role: episodePeople.role })
    .from(episodePeople)
    .innerJoin(episodes, eq(episodes.id, episodePeople.episodeId))
    .where(eq(episodePeople.personId, id))
    .all();
  const onPublicSite = p.role === "host" || credits.some((c) => c.status === "published" && c.visibility === "public");
  return {
    person: { id: p.id, name: p.name, role: p.role, bio: p.bio, website: p.website },
    slug: show.slug,
    publicPath: `/people/${p.id}/${slugify(p.name)}`,
    onPublicSite,
    credits,
    avatar: a ? { url: avatarUrl(show.slug, id, a)!, bytes: a.bytes, contentType: a.contentType } : null,
    storageReady: routedTarget("feedMedia") !== null,
  };
}

export function createPerson(name: string, role: string): { ok: true; id: string } | { ok: false; error: string } {
  const show = db.select({ id: shows.id }).from(shows).get();
  const n = name.trim().slice(0, 120);
  if (!show) return { ok: false, error: "No show." };
  if (!n) return { ok: false, error: "Name is required." };
  if (!PERSON_ROLES.includes(role as (typeof PERSON_ROLES)[number])) return { ok: false, error: "Pick host or guest." };
  const dup = db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.showId, show.id), sql`lower(${people.name}) = ${n.toLowerCase()}`))
    .get();
  if (dup) return { ok: false, error: `${n} already exists.` };
  const id = crypto.randomUUID();
  db.insert(people).values({ id, showId: show.id, name: n, role, avatar: null, website: null, socials: null, bio: null, avatarAssetId: null }).run();
  return { ok: true, id };
}

export function updatePerson(
  id: string,
  input: { name: string; role: string; bio: string; website: string },
): { ok: true } | { ok: false; error: string } {
  const p = db.select().from(people).where(eq(people.id, id)).get();
  if (!p) return { ok: false, error: "Person not found." };
  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false, error: "Name is required." };
  if (!PERSON_ROLES.includes(input.role as (typeof PERSON_ROLES)[number])) return { ok: false, error: "Pick host or guest." };
  const bio = input.bio.trim().slice(0, 2000);
  let website: string | null = null;
  if (input.website.trim()) {
    try {
      const u = new URL(input.website.trim());
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
      website = u.toString();
    } catch {
      return { ok: false, error: "Website must be a full link starting with http:// or https://." };
    }
  }
  const dup = db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.showId, p.showId), sql`lower(${people.name}) = ${name.toLowerCase()}`))
    .all()
    .find((r) => r.id !== id);
  if (dup) return { ok: false, error: `Someone named ${name} already exists.` };
  db.update(people).set({ name, role: input.role, bio: bio || null, website }).where(eq(people.id, id)).run();
  return { ok: true };
}

/** Only people with no credits can be deleted (credits drive the feed's podcast:person). */
export async function deletePerson(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const used = db.select({ n: sql<number>`count(*)` }).from(episodePeople).where(eq(episodePeople.personId, id)).get()?.n ?? 0;
  if (used > 0) return { ok: false, error: `Credited on ${used} episode${used === 1 ? "" : "s"} — remove those credits first.` };
  await removePersonAvatar(id);
  db.delete(people).where(eq(people.id, id)).run();
  return { ok: true };
}

export type AvatarResult = { ok: true } | { ok: false; error: string; status: number };

export async function uploadPersonAvatar(personId: string, body: ReadableStream<Uint8Array> | null, declaredLength: number | null): Promise<AvatarResult> {
  const person = db.select().from(people).where(eq(people.id, personId)).get();
  if (!person) return { ok: false, error: "Person not found.", status: 404 };
  if (!body) return { ok: false, error: "No file received.", status: 400 };
  if (declaredLength !== null && declaredLength > ARTWORK_MAX_BYTES) return { ok: false, error: "The photo must be under 5 MB.", status: 413 };
  const target = routedTarget("feedMedia");
  if (!target) return { ok: false, error: "No storage target is routed for feed media. Set one up in Storage.", status: 409 };

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > ARTWORK_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return { ok: false, error: "The photo must be under 5 MB.", status: 413 };
    }
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks);
  const info = imageInfo(buf);
  const problem = avatarProblem(info);
  if (problem || !info) return { ok: false, error: problem ?? "Unreadable image.", status: 422 };

  const sha256 = createHash("sha256").update(buf).digest("hex");
  const assetId = crypto.randomUUID();
  const key = `avatars/${personId}/${assetId}.${EXT[info.type]}`;
  const previous = person.avatarAssetId;
  db.insert(assets)
    .values({ id: assetId, showId: person.showId, kind: "person_avatar", access: "public", storageTargetId: target.id, key, filename: key.split("/").pop()!, contentType: TYPE[info.type], status: "pending", createdAt: Date.now() })
    .run();

  const client = clientFor(target);
  try {
    await client.send(new PutObjectCommand({ Bucket: target.bucket, Key: key, Body: buf, ContentType: TYPE[info.type] }));
    const head = await client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: key }));
    if (head.ContentLength !== buf.length) throw new Error(`Stored size ${head.ContentLength} doesn't match ${buf.length} bytes.`);
    const obj = await client.send(new GetObjectCommand({ Bucket: target.bucket, Key: key }));
    const back = createHash("sha256");
    for await (const c of obj.Body as Readable) back.update(c as Buffer);
    if (back.digest("hex") !== sha256) throw new Error("Stored bytes don't match what was uploaded.");
    db.transaction((tx) => {
      tx.update(assets)
        .set({ status: "verified", bytes: buf.length, sha256, meta: { width: info.width, height: info.height }, verifiedAt: Date.now() })
        .where(eq(assets.id, assetId))
        .run();
      tx.update(people).set({ avatarAssetId: assetId }).where(eq(people.id, personId)).run();
    });
    if (previous) await removeAsset(previous).catch(() => {});
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(assets).set({ status: "failed", error: message.slice(0, 500) }).where(eq(assets.id, assetId)).run();
    await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: key })).catch(() => {});
    return { ok: false, error: `Upload failed: ${message}`, status: 502 };
  } finally {
    client.destroy();
  }
}

async function removeAsset(assetId: string) {
  const asset = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!asset) return;
  const target = db.select().from(storageTargets).where(eq(storageTargets.id, asset.storageTargetId)).get();
  if (target) {
    const client = clientFor(target);
    try {
      await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: asset.key }));
    } finally {
      client.destroy();
    }
  }
  db.delete(assets).where(eq(assets.id, assetId)).run();
}

export async function removePersonAvatar(personId: string) {
  const p = db.select({ avatarAssetId: people.avatarAssetId }).from(people).where(eq(people.id, personId)).get();
  if (!p?.avatarAssetId) return;
  db.update(people).set({ avatarAssetId: null }).where(eq(people.id, personId)).run();
  await removeAsset(p.avatarAssetId).catch(() => {});
}

// ---- public side ------------------------------------------------------------

/** Avatar asset for a person, but only if they may appear on the public site. */
export function findPublicAvatar(slug: string, personId: string) {
  const show = db.select({ id: shows.id, slug: shows.slug }).from(shows).where(eq(shows.slug, slug)).get();
  const person = db.select().from(people).where(eq(people.id, personId)).get();
  if (!show || !person || person.showId !== show.id) return null;
  if (!isPubliclyListed(person.id, person.role)) return null;
  return avatarAsset(personId);
}

export function isPubliclyListed(personId: string, role: string | null) {
  if (role === "host") return true;
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(episodePeople)
      .innerJoin(episodes, eq(episodes.id, episodePeople.episodeId))
      .where(and(eq(episodePeople.personId, personId), eq(episodes.status, "published"), eq(episodes.visibility, "public")))
      .get()?.n! > 0
  );
}

export async function openAvatar(a: NonNullable<ReturnType<typeof avatarAsset>>) {
  const target = db.select().from(storageTargets).where(eq(storageTargets.id, a.targetId)).get();
  if (!target) return null;
  const client = clientFor(target);
  try {
    const obj = await client.send(new GetObjectCommand({ Bucket: target.bucket, Key: a.key }));
    const body = obj.Body as Readable;
    body.on("close", () => client.destroy());
    return body;
  } catch (err) {
    client.destroy();
    throw err;
  }
}

/** Avatars for a set of people, keyed by person id (public URLs, verified assets only). */
export function avatarUrlsFor(slug: string, personIds: string[]) {
  if (personIds.length === 0) return new Map<string, string>();
  const rows = db
    .select({ personId: people.id, ...avatarCols })
    .from(people)
    .innerJoin(assets, and(eq(assets.id, people.avatarAssetId), eq(assets.status, "verified")))
    .where(inArray(people.id, personIds))
    .all();
  return new Map(rows.map((r) => [r.personId, avatarUrl(slug, r.personId, r)!]));
}
