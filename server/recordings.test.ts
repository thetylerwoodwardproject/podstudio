import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { signedIn } from "./testing.ts";
import { createEditorProject } from "../src/lib/editor-project.ts";

test("group deletion is authoritative, idempotent, and rejects stale uploads without deleting the episode or media", async () => {
  const s = await signedIn();
  try {
    await s.call("/api/episodes");
    for (const id of ["host", "guest"]) {
      const meta = {
        id,
        group: "group",
        episodeId: "142",
        sampleRate: 48000,
        samples: 100,
        bitDepth: 16,
        channels: 1,
        status: "done",
      };
      await s.call(`/api/takes/${id}`, {
        method: "PUT",
        body: { meta, done: true },
      });
      await s.call(`/api/takes/${id}/segments/1`, {
        method: "PUT",
        raw: Buffer.alloc(200),
      });
    }
    const project = createEditorProject({
      takeId: "host",
      episodeId: "142",
      name: "Episode",
      sources: [
        {
          id: "host",
          name: "Host",
          kind: "voice",
          duration: 10,
          sampleRate: 48000,
          channels: 1,
        },
      ],
    });
    await s.call("/api/editor-projects/host", {
      method: "PUT",
      body: { project, baseRevision: 0 },
    });
    await s.call("/api/media/clip?name=Independent&seconds=1", {
      method: "PUT",
      raw: Buffer.alloc(100),
    });
    const deleted = await s.call("/api/recordings/host", { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body.ids.sort(), ["guest", "host"]);
    assert.equal(existsSync(join(s.ctx.config.data, "takes", "host")), false);
    assert.equal(
      (await s.call("/api/editor-projects/host")).body.project,
      null,
    );
    assert.equal((await s.call("/api/episodes/142")).status, 200);
    assert.equal((await s.call("/api/media/clip")).status, 200);
    assert.equal(
      (await s.call("/api/recordings/host", { method: "DELETE" })).status,
      200,
    );
    assert.equal(
      (
        await s.call("/api/takes/host", {
          method: "PUT",
          body: { meta: { id: "host", episodeId: "142", group: "group" } },
        })
      ).status,
      410,
    );
    assert.equal(
      (
        await s.call("/api/takes/new-stale-guest", {
          method: "PUT",
          body: {
            meta: { id: "new-stale-guest", episodeId: "142", group: "group" },
          },
        })
      ).status,
      410,
    );
    assert.equal(
      (
        await s.call("/api/takes/guest/segments/2", {
          method: "PUT",
          raw: Buffer.alloc(20),
        })
      ).status,
      410,
    );
    assert.equal(
      (await s.call("/api/recordings/deleted?episode=142")).body.deleted.length,
      2,
    );
  } finally {
    s.done();
  }
});

test("live/incomplete and dependent recordings cannot be deleted", async () => {
  const s = await signedIn();
  try {
    await s.call("/api/episodes");
    const meta = {
      id: "source",
      group: "source-group",
      episodeId: "142",
      sampleRate: 48000,
      bitDepth: 16,
      channels: 1,
    };
    await s.call("/api/takes/source", { method: "PUT", body: { meta } });
    assert.equal(
      (await s.call("/api/recordings/source", { method: "DELETE" })).status,
      409,
    );
    await s.call("/api/takes/source", {
      method: "PUT",
      body: { meta, done: true },
    });
    await s.call("/api/takes/other", {
      method: "PUT",
      body: {
        meta: { ...meta, id: "other", group: "other-group" },
        done: true,
      },
    });
    const project = createEditorProject({
      takeId: "other",
      episodeId: "142",
      name: "Dependent",
      sources: [
        {
          id: "source",
          name: "Referenced",
          kind: "voice",
          duration: 10,
          sampleRate: 48000,
          channels: 1,
        },
      ],
    });
    await s.call("/api/editor-projects/other", {
      method: "PUT",
      body: { project, baseRevision: 0 },
    });
    const r = await s.call("/api/recordings/source", { method: "DELETE" });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /used by/);
    assert.equal((await s.call("/api/takes/source")).status, 200);
  } finally {
    s.done();
  }
});

test("a never-uploaded recording receives a tombstone before local deletion", async () => {
  const s = await signedIn();
  try {
    await s.call("/api/episodes");
    assert.equal(await s.anon("/api/recordings/deleted?episode=142"), 401);
    assert.equal(
      (
        await s.call("/api/recordings/local", {
          method: "DELETE",
          body: { episodeId: "142", group: "local", ids: ["local"] },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await s.call("/api/takes/local", {
          method: "PUT",
          body: { meta: { id: "local", episodeId: "142" } },
        })
      ).status,
      410,
    );
  } finally {
    s.done();
  }
});
