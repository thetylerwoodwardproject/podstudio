import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { publishDueEpisodes } from "@podstudio/db/scheduler";

const db = new Database(":memory:");

function ep(id: string, o: { status?: string; publishAt?: number | null; audio?: "verified" | "pending" | null }) {
  const audioId = o.audio ? `a-${id}` : null;
  if (audioId) db.prepare("insert into assets (id, status) values (?, ?)").run(audioId, o.audio);
  db.prepare(
    "insert into episodes (id, status, visibility, publish_at, audio_asset_id, updated_at) values (?, ?, 'private', ?, ?, 0)",
  ).run(id, o.status ?? "scheduled", o.publishAt ?? null, audioId);
}
const row = (id: string) => db.prepare("select status, visibility, publish_at as publishAt from episodes where id = ?").get(id) as any;

beforeEach(() => {
  db.exec(`drop table if exists episodes; drop table if exists assets;
    create table assets (id text primary key, status text);
    create table episodes (id text primary key, status text, visibility text, publish_at integer, audio_asset_id text, updated_at integer);`);
});

describe("publishDueEpisodes", () => {
  it("publishes a due scheduled episode with verified audio, keeping publish_at", () => {
    ep("a", { publishAt: 1000, audio: "verified" });
    expect(publishDueEpisodes(db, 2000)).toEqual({ published: ["a"], blocked: [] });
    expect(row("a")).toEqual({ status: "published", visibility: "public", publishAt: 1000 });
  });

  it("leaves future episodes alone", () => {
    ep("a", { publishAt: 3000, audio: "verified" });
    expect(publishDueEpisodes(db, 2000)).toEqual({ published: [], blocked: [] });
    expect(row("a").status).toBe("scheduled");
  });

  it("publishes exactly at the scheduled instant", () => {
    ep("a", { publishAt: 2000, audio: "verified" });
    expect(publishDueEpisodes(db, 2000).published).toEqual(["a"]);
  });

  it("blocks due episodes without verified audio and leaves them scheduled", () => {
    ep("none", { publishAt: 1000, audio: null });
    ep("pend", { publishAt: 1000, audio: "pending" });
    const r = publishDueEpisodes(db, 2000);
    expect(r.published).toEqual([]);
    expect(r.blocked.sort()).toEqual(["none", "pend"]);
    expect(row("none")).toMatchObject({ status: "scheduled", visibility: "private" });
  });

  it("ignores non-scheduled episodes even with a past publish_at", () => {
    ep("ed", { status: "editing", publishAt: 1000, audio: "verified" });
    ep("pub", { status: "published", publishAt: 1000, audio: "verified" });
    expect(publishDueEpisodes(db, 2000)).toEqual({ published: [], blocked: [] });
    expect(row("ed").status).toBe("editing");
  });

  it("is idempotent", () => {
    ep("a", { publishAt: 1000, audio: "verified" });
    publishDueEpisodes(db, 2000);
    expect(publishDueEpisodes(db, 3000)).toEqual({ published: [], blocked: [] });
  });
});
