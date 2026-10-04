import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { signedIn } from "./testing.ts";
import { createEditorProject } from "../src/lib/editor-project.ts";
import {
  audioConfiguration,
  emptyPackage,
} from "../src/lib/episode-package.ts";
import { encodeWav } from "../src/lib/audio/wav.ts";

async function prepared(s: Awaited<ReturnType<typeof signedIn>>) {
  await s.call("/api/episodes");
  await s.call("/api/takes/take", {
    method: "PUT",
    body: {
      meta: {
        id: "take",
        episodeId: "142",
        sampleRate: 48000,
        bitDepth: 16,
        channels: 1,
        samples: 48000,
        status: "done",
      },
      done: true,
    },
  });
  const project = createEditorProject({
    takeId: "take",
    episodeId: "142",
    name: "Mix",
    sources: [
      {
        id: "take",
        name: "Host",
        kind: "voice",
        duration: 1,
        sampleRate: 48000,
        channels: 1,
      },
    ],
  });
  await s.call("/api/editor-projects/take", {
    method: "PUT",
    body: { project, baseRevision: 0 },
  });
  const wav = encodeWav([new Float32Array(48000)], {
    sampleRate: 48000,
    channels: 1,
    bitDepth: 16,
  });
  const fingerprint = createHash("sha256")
    .update(audioConfiguration(project))
    .digest("hex");
  const r = await s.call("/api/prepared-audio", {
    body: {
      takeId: "take",
      episodeId: "142",
      revision: 1,
      fingerprint,
      bytes: wav.size,
    },
  });
  assert.equal(r.status, 201);
  const id = r.body.id;
  assert.equal(
    (
      await s.call(`/api/prepared-audio/${id}/chunks/0`, {
        method: "PUT",
        raw: wav,
      })
    ).status,
    200,
  );
  assert.equal(
    (await s.call(`/api/prepared-audio/${id}/complete`, { body: {} })).status,
    200,
  );
  await s.call("/api/episode-packages/142", {
    body: { baseRevision: 0, audioId: id },
  });
  await s.call(`/api/prepared-audio/${id}/ai/0`, {
    method: "PUT",
    raw: Buffer.from("test mp3 fixture"),
  });
  await s.call(`/api/prepared-audio/${id}/ai-manifest`, {
    method: "PUT",
    body: { chunks: [{ start: 0, end: 1, bytes: 16 }] },
  });
  return { id, project, fingerprint };
}
const key = "sk-proj-private-test-key-never-returned";
async function credentials(s: Awaited<ReturnType<typeof signedIn>>) {
  s.ctx.aiCredentials.request = async () => new Response("{}", { status: 200 });
  assert.equal(
    (await s.call("/api/me/ai", { method: "PUT", body: { key } })).status,
    200,
  );
}
async function wait(s: Awaited<ReturnType<typeof signedIn>>, id: string) {
  for (let n = 0; n < 100; n++) {
    const r = await s.call(`/api/generation-jobs/${id}`);
    if (["completed", "failed", "cancelled"].includes(r.body.state))
      return r.body;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("Job did not finish");
}

test("API keys are verified, encrypted, masked, and removable without returning secrets", async () => {
  const s = await signedIn();
  try {
    assert.equal(await s.anon("/api/me/ai"), 401);
    assert.equal((await s.call("/api/me/ai")).body.configured, false);
    await credentials(s);
    const result = await s.call("/api/me/ai");
    assert.equal(result.body.valid, true);
    assert.equal(JSON.stringify(result.body).includes(key), false);
    const row = s.ctx.db.prepare("SELECT cipher FROM ai_credentials").get() as {
      cipher: string;
    };
    assert.equal(row.cipher.includes(key), false);
    assert.equal(s.ctx.aiCredentials.key(1), key);
    assert.equal(
      statSync(join(s.ctx.config.data, ".ai-key")).mode & 0o777,
      0o600,
    );
    assert.equal(readFileSync(join(s.ctx.config.data, ".ai-key")).length, 32);
    s.ctx.aiCredentials.request = async () =>
      new Response("{}", { status: 401 });
    assert.equal(
      (
        await s.call("/api/me/ai", {
          method: "PUT",
          body: { key: "sk-replacement-invalid-key" },
        })
      ).status,
      422,
    );
    assert.equal(s.ctx.aiCredentials.key(1), key);
    await s.call("/api/me/ai", { method: "DELETE" });
    assert.equal((await s.call("/api/me/ai")).body.configured, false);
  } finally {
    s.done();
  }
});
test("finished audio is revision-specific and generation preserves approved text until explicit acceptance", async () => {
  const s = await signedIn();
  try {
    const { id, project, fingerprint } = await prepared(s);
    await credentials(s);
    const original = emptyPackage("142");
    original.materials.title = "Approved title";
    assert.equal(
      (
        await s.call("/api/episode-packages/142", {
          method: "PUT",
          body: { baseRevision: 1, package: original },
        })
      ).status,
      200,
    );
    s.ctx.preparation.request = async (url, options) => {
      assert.equal(
        (options?.headers as Record<string, string>).Authorization,
        `Bearer ${key}`,
      );
      if (String(url).endsWith("audio/transcriptions")) {
        const form = options!.body as FormData;
        assert.equal(form.get("model"), "whisper-1");
        assert.equal(form.get("timestamp_granularities[]"), "word");
        return Response.json({
          words: [{ word: "Hello.", start: 0.1, end: 0.5 }],
        });
      }
      const body = JSON.parse(options!.body as string);
      assert.equal(body.model, "gpt-4.1-mini");
      assert.equal(body.text.format.strict, true);
      return Response.json({
        status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  titles: ["One", "Two", "Three"],
                  description: "A factual draft.",
                  chapters: [{ start: 0, title: "Intro" }],
                  soundbites: [{ start: 0, end: 1, title: "Hello" }],
                }),
              },
            ],
          },
        ],
      });
    };
    const request = {
      id: "job-one",
      episodeId: "142",
      audioId: id,
      section: "all",
    };
    assert.equal(
      (await s.call("/api/generation-jobs", { body: request })).status,
      202,
    );
    assert.equal((await wait(s, "job-one")).state, "completed");
    const result = (await s.call("/api/episode-packages/142")).body;
    assert.equal(result.package.materials.title, "Approved title");
    assert.deepEqual(result.package.suggestions.titles, [
      "One",
      "Two",
      "Three",
    ]);
    assert.equal(result.package.suggestions.fingerprint, fingerprint);
    assert.equal(
      (
        await s.call("/api/episode-packages/142", {
          method: "PUT",
          body: { baseRevision: 0, package: original },
        })
      ).status,
      409,
    );
    project.tracks[0].gainDb = 10;
    await s.call("/api/editor-projects/take", {
      method: "PUT",
      body: { baseRevision: 1, project },
    });
    assert.equal(
      (await s.call("/api/episode-packages/142")).body.sourceCurrent,
      false,
    );
    assert.equal(
      (
        await s.call("/api/generation-jobs", {
          body: { ...request, id: "job-stale" },
        })
      ).status,
      409,
    );
    await s.call("/api/recordings/take", { method: "DELETE" });
    const retained = (await s.call("/api/episode-packages/142")).body;
    assert.equal(retained.package.materials.title, "Approved title");
    assert.equal(retained.sourceAvailable, false);
    assert.equal((await s.call(`/api/prepared-audio/${id}/wav`)).status, 404);
  } finally {
    s.done();
  }
});
test("missing credentials disable generation only; provider failures are safe and retry remains explicit", async () => {
  const s = await signedIn();
  try {
    const { id } = await prepared(s);
    assert.equal(
      (
        await s.call("/api/generation-jobs", {
          body: {
            id: "job-missing",
            episodeId: "142",
            audioId: id,
            section: "all",
          },
        })
      ).status,
      422,
    );
    assert.equal((await s.call("/api/episode-packages/142")).status, 200);
    await credentials(s);
    s.ctx.preparation.request = async () =>
      Response.json(
        { error: { message: "secret provider details" } },
        { status: 429 },
      );
    await s.call("/api/generation-jobs", {
      body: { id: "job-quota", episodeId: "142", audioId: id, section: "all" },
    });
    const job = await wait(s, "job-quota");
    assert.equal(job.state, "failed");
    assert.match(job.error, /quota/);
    assert.equal(job.error.includes("secret"), false);
    assert.equal((await s.call("/api/me/ai")).body.status, "quota");
  } finally {
    s.done();
  }
});

test("overlapping transcription chunks reconcile timestamps and a retry resumes completed chunks", async () => {
  const s = await signedIn();
  try {
    const { id } = await prepared(s);
    await credentials(s);
    s.ctx.db
      .prepare("UPDATE prepared_audio SET duration=601, manifest=? WHERE id=?")
      .run(
        JSON.stringify([
          { start: 0, end: 600, bytes: 16 },
          { start: 598, end: 601, bytes: 16 },
        ]),
        id,
      );
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(s.ctx.preparedAudio.dir(id), "ai-1.mp3"),
      "test mp3 fixture",
    );
    let calls = 0;
    s.ctx.preparation.request = async () => {
      calls++;
      if (calls === 1)
        return Response.json({
          words: [{ word: "First.", start: 599, end: 599.5 }],
        });
      if (calls === 2) return Response.json({}, { status: 503 });
      return Response.json({
        words: [
          { word: "Duplicate.", start: 1, end: 1.5 },
          { word: "Second.", start: 2.2, end: 2.6 },
        ],
      });
    };
    await s.call("/api/generation-jobs", {
      body: {
        id: "long-job",
        episodeId: "142",
        audioId: id,
        section: "transcript",
      },
    });
    assert.equal((await wait(s, "long-job")).state, "failed");
    assert.equal(calls, 2);
    assert.equal(
      (await s.call("/api/generation-jobs/long-job/retry", { body: {} }))
        .status,
      202,
    );
    assert.equal((await wait(s, "long-job")).state, "completed");
    assert.equal(calls, 3);
    const transcript = (await s.call("/api/episode-packages/142")).body.package
      .suggestions.transcript;
    assert.deepEqual(
      transcript.map((t: { text: string }) => t.text),
      ["First.", "Second."],
    );
    assert.equal(transcript[1].start, 600.2);
  } finally {
    s.done();
  }
});
test("cancelled jobs do not replace suggestions and removal invalidates provider credentials", async () => {
  const s = await signedIn();
  try {
    const { id } = await prepared(s);
    await credentials(s);
    let started!: () => void;
    const begun = new Promise<void>((r) => (started = r));
    s.ctx.preparation.request = async (_url, o) => {
      started();
      await new Promise((resolve, reject) => {
        o!.signal!.addEventListener(
          "abort",
          () => reject(new Error("Cancelled")),
          { once: true },
        );
      });
      return Response.json({});
    };
    await s.call("/api/generation-jobs", {
      body: { id: "cancel-job", episodeId: "142", audioId: id, section: "all" },
    });
    await begun;
    await s.call("/api/me/ai", { method: "DELETE" });
    assert.equal((await wait(s, "cancel-job")).state, "cancelled");
    assert.equal(
      (await s.call("/api/episode-packages/142")).body.package.suggestions,
      null,
    );
    await s.ctx.preparation.pump();
  } finally {
    s.done();
  }
});
