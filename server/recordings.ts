import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { TakeMeta } from "../src/lib/audio/takes.ts";
import type { Context } from "./context.ts";
import { tx } from "./db.ts";
import { HttpError, json, readJson } from "./http.ts";

export const recordingId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(id);
interface Deleted {
  take_id: string;
  episode_id: string;
  group_id: string;
  live_id: string | null;
  cleaned: number;
}

/** The journal is committed first. Filesystem cleanup is idempotent after a restart. */
export class Recordings {
  private ctx: Context;
  constructor(ctx: Context) {
    this.ctx = ctx;
  }
  deleted(id: string) {
    return !!this.ctx.db
      .prepare("SELECT 1 FROM recording_deletions WHERE take_id = ?")
      .get(id);
  }
  deletedGroup(episode: string, group: string) {
    return !!this.ctx.db
      .prepare(
        "SELECT 1 FROM recording_deletions WHERE episode_id = ? AND group_id = ?",
      )
      .get(episode, group);
  }
  deletedLive(id: string) {
    return !!this.ctx.db
      .prepare("SELECT 1 FROM recording_deletions WHERE live_id = ?")
      .get(id);
  }
  async cleanup(ids?: string[]) {
    const rows = this.ctx.db
      .prepare("SELECT * FROM recording_deletions WHERE cleaned = 0")
      .all() as unknown as Deleted[];
    for (const row of rows) {
      if (ids && !ids.includes(row.take_id)) continue;
      this.ctx.preparation.cancelRecordings([row.take_id]);
      for (const audio of this.ctx.db
        .prepare("SELECT id FROM prepared_audio WHERE take_id = ?")
        .all(row.take_id) as { id: string }[]) {
        this.ctx.db
          .prepare("UPDATE prepared_audio SET state = 'deleted' WHERE id = ?")
          .run(audio.id);
        await rm(this.ctx.preparedAudio.dir(audio.id), {
          force: true,
          recursive: true,
        });
      }
      await rm(join(this.ctx.config.data, "takes", row.take_id), {
        force: true,
        recursive: true,
      });
      if (row.live_id)
        await rm(join(this.ctx.config.data, "live", row.live_id), {
          force: true,
          recursive: true,
        });
      this.ctx.db
        .prepare("UPDATE recording_deletions SET cleaned = 1 WHERE take_id = ?")
        .run(row.take_id);
    }
  }
  async remove(
    id: string,
    input?: { episodeId?: string; ids?: string[]; group?: string },
  ) {
    if (!recordingId(id)) throw new HttpError(400, "Invalid recording");
    const db = this.ctx.db;
    const prior = db
      .prepare("SELECT * FROM recording_deletions WHERE take_id = ?")
      .get(id) as unknown as Deleted | undefined;
    if (prior) {
      const ids = (
        db
          .prepare(
            "SELECT take_id FROM recording_deletions WHERE episode_id = ? AND group_id = ?",
          )
          .all(prior.episode_id, prior.group_id) as { take_id: string }[]
      ).map((x) => x.take_id);
      await this.cleanup(ids);
      return { ids };
    }
    const root = db
      .prepare("SELECT meta, done FROM takes WHERE id = ?")
      .get(id) as { meta: string; done: number } | undefined;
    const host =
      !root && id.endsWith("-guest")
        ? (db
            .prepare("SELECT meta, done FROM takes WHERE id = ?")
            .get(id.slice(0, -6)) as { meta: string; done: number } | undefined)
        : undefined;
    const seed = root ?? host;
    const meta = seed ? (JSON.parse(seed.meta) as TakeMeta) : null;
    const episodeId = meta?.episodeId ?? input?.episodeId;
    if (!episodeId || !this.ctx.library.get(episodeId))
      throw new HttpError(404, "No such episode");
    const group = meta?.group ?? meta?.id ?? input?.group ?? id;
    if (!recordingId(group))
      throw new HttpError(400, "Invalid recording group");
    if (
      input?.ids &&
      (!Array.isArray(input.ids) ||
        input.ids.length > 64 ||
        !input.ids.every(recordingId))
    )
      throw new HttpError(400, "Invalid recording tracks");
    const rows = db
      .prepare("SELECT id, meta, done FROM takes WHERE episode_id = ?")
      .all(episodeId) as { id: string; meta: string; done: number }[];
    const tracks = rows.filter((r) => {
      const m = JSON.parse(r.meta) as TakeMeta;
      return r.id === id || r.id === meta?.id || (m.group ?? m.id) === group;
    });
    const ids = [
      ...new Set([
        id,
        ...(meta ? [meta.id] : []),
        ...tracks.map((t) => t.id),
        ...(input?.ids ?? []),
      ]),
    ];
    for (const extra of input?.ids ?? []) {
      const r = db
        .prepare("SELECT episode_id, meta FROM takes WHERE id = ?")
        .get(extra) as { episode_id: string; meta: string } | undefined;
      if (
        r &&
        (r.episode_id !== episodeId ||
          (JSON.parse(r.meta).group ?? extra) !== group)
      )
        throw new HttpError(409, "A listed track belongs to another recording");
    }
    const liveIds = new Set<string>();
    for (const row of tracks) {
      const m = JSON.parse(row.meta) as TakeMeta;
      if (!row.done)
        throw new HttpError(
          409,
          "Wait for this recording to finish synchronizing before deleting it",
        );
      const liveId = m.guest?.sessionId;
      if (
        liveId &&
        recordingId(liveId) &&
        this.ctx.live.session(liveId)?.episodeId === episodeId
      ) {
        if (!this.ctx.live.session(liveId)?.ended)
          throw new HttpError(
            409,
            "End the live session before deleting its recording",
          );
        liveIds.add(liveId);
        ids.push(`${row.id}-guest`);
      }
    }
    const own = new Set(ids);
    for (const row of db
      .prepare("SELECT take_id, episode_id, value FROM editor_projects")
      .all() as { take_id: string; episode_id: string; value: string }[]) {
      if (own.has(row.take_id)) continue;
      const p = JSON.parse(row.value);
      const depends = (source: string) =>
        own.has(source) ||
        [...own].some(
          (id) =>
            source === `pads:${id}` ||
            source === `${id}:pads` ||
            source === `pads-${id}`,
        );
      if (
        [...(p.tracks ?? []), ...(p.removedTracks ?? [])].some(
          (t: { sourceId: string; clips: { sourceId: string }[] }) =>
            depends(t.sourceId) || t.clips.some((c) => depends(c.sourceId)),
        )
      )
        throw new HttpError(
          409,
          `This recording is used by ${this.ctx.library.get(row.episode_id)?.fullTitle ?? row.episode_id}. Remove that dependency first.`,
        );
    }
    tx(db, () => {
      const tombstone = db.prepare(
        "INSERT OR IGNORE INTO recording_deletions(take_id, episode_id, group_id, live_id, deleted_at) VALUES (?, ?, ?, ?, ?)",
      );
      for (const takeId of new Set(ids)) {
        tombstone.run(
          takeId,
          episodeId,
          group,
          [...liveIds][0] ?? null,
          Date.now(),
        );
        db.prepare("DELETE FROM takes WHERE id = ?").run(takeId);
      }
      for (const liveId of liveIds)
        db.prepare("DELETE FROM live_sessions WHERE id = ?").run(liveId);
    });
    await this.cleanup(ids);
    return { ids: [...new Set(ids)] };
  }
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    p: string[],
  ) {
    if (p[0] !== "recordings") return false;
    if (p[1] === "deleted" && req.method === "GET") {
      const rows = this.ctx.db
        .prepare(
          'SELECT take_id AS id, group_id AS "group" FROM recording_deletions WHERE episode_id = ?',
        )
        .all(url.searchParams.get("episode") ?? "");
      json(res, 200, { deleted: rows });
      return true;
    }
    if (p.length === 2 && req.method === "DELETE") {
      json(res, 200, await this.remove(p[1], await readJson(req)));
      return true;
    }
    throw new HttpError(404, "Not found");
  }
}
