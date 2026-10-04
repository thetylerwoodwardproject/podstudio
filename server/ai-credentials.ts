import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "./context.ts";
import { HttpError, RateLimit, json, readJson } from "./http.ts";

export function providerError(status: number): HttpError {
  if (status === 401)
    return new HttpError(
      422,
      "OpenAI rejected the API key. Update it in Settings.",
    );
  if (status === 403 || status === 404)
    return new HttpError(
      422,
      "This key does not have access to the required OpenAI models.",
    );
  if (status === 429)
    return new HttpError(
      429,
      "OpenAI quota or rate limit reached. Check your OpenAI billing and retry later.",
    );
  return new HttpError(
    502,
    "OpenAI is unavailable. Your recording and saved results are safe. Try again later.",
  );
}
export class AiCredentials {
  private ctx: Context;
  request: typeof fetch = (...args) => fetch(...args);
  private limit = new RateLimit(10, 60000);
  constructor(ctx: Context) {
    this.ctx = ctx;
  }
  private masterKey(): Buffer {
    const file = join(this.ctx.config.data, ".ai-key");
    if (!existsSync(file)) {
      if (this.ctx.db.prepare("SELECT 1 FROM ai_credentials LIMIT 1").get())
        throw new HttpError(
          503,
          "Restore the server encryption key from backup before using AI.",
        );
      try {
        writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" });
      } catch (e) {
        if (!existsSync(file)) throw e;
      }
    }
    chmodSync(file, 0o600);
    const key = readFileSync(file);
    if (key.length !== 32)
      throw new HttpError(
        503,
        "The server encryption key needs to be restored from backup.",
      );
    return key;
  }
  key(user: number): string {
    const row = this.ctx.db
      .prepare("SELECT cipher FROM ai_credentials WHERE user_id = ?")
      .get(user) as { cipher: string } | undefined;
    if (!row)
      throw new HttpError(422, "Add an OpenAI API key in Settings first.");
    try {
      const bytes = Buffer.from(row.cipher, "base64");
      const decoder = createDecipheriv(
        "aes-256-gcm",
        this.masterKey(),
        bytes.subarray(0, 12),
      );
      decoder.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([
        decoder.update(bytes.subarray(28)),
        decoder.final(),
      ]).toString("utf8");
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(
        503,
        "The stored API key could not be decrypted. Restore the encryption key or replace the API key.",
      );
    }
  }
  status(user: number) {
    const row = this.ctx.db
      .prepare(
        "SELECT suffix, status, updated_at FROM ai_credentials WHERE user_id = ?",
      )
      .get(user) as
      { suffix: string; status: string; updated_at: number } | undefined;
    return {
      configured: !!row,
      valid: row?.status === "connected",
      status: row?.status ?? "missing",
      suffix: row?.suffix ?? "",
      checkedAt: row?.updated_at ?? null,
      transcriptionModel: "whisper-1",
      writingModel: "gpt-4.1-mini",
    };
  }
  invalidate(user: number, status: number) {
    if ([401, 403, 404, 429].includes(status))
      this.ctx.db
        .prepare(
          "UPDATE ai_credentials SET status = ?, updated_at = ? WHERE user_id = ?",
        )
        .run(status === 429 ? "quota" : "invalid", Date.now(), user);
  }
  async validate(key: string) {
    if (
      typeof key !== "string" ||
      key.length < 15 ||
      key.length > 500 ||
      /\s/.test(key)
    )
      throw new HttpError(400, "Enter your OpenAI API key.");
    for (const model of ["whisper-1", "gpt-4.1-mini"]) {
      let r: Response;
      try {
        r = await this.request(`https://api.openai.com/v1/models/${model}`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw new HttpError(
          502,
          "Could not reach OpenAI. Check the server connection and try again.",
        );
      }
      if (!r.ok) throw providerError(r.status);
      await r.body?.cancel();
    }
  }
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    p: string[],
    user: number,
  ) {
    if (p.join("/") !== "me/ai") return false;
    if (req.method === "GET") {
      json(res, 200, this.status(user));
      return true;
    }
    if (req.method === "DELETE") {
      this.ctx.preparation.cancelUser(user);
      this.ctx.db
        .prepare("DELETE FROM ai_credentials WHERE user_id = ?")
        .run(user);
      json(res, 200, this.status(user));
      return true;
    }
    if (req.method === "PUT" || req.method === "POST") {
      if (!this.limit.hit(String(user)))
        throw new HttpError(
          429,
          "Wait a minute before testing your API key again.",
        );
      const { key } = await readJson<{ key?: string }>(req, 2048);
      const value = req.method === "PUT" ? (key ?? "") : this.key(user);
      await this.validate(value);
      if (req.method === "PUT") {
        const nonce = randomBytes(12),
          encoder = createCipheriv("aes-256-gcm", this.masterKey(), nonce);
        const ciphertext = Buffer.concat([
          encoder.update(value, "utf8"),
          encoder.final(),
        ]);
        const cipher = Buffer.concat([
          nonce,
          encoder.getAuthTag(),
          ciphertext,
        ]).toString("base64");
        this.ctx.db
          .prepare(
            "INSERT INTO ai_credentials(user_id, cipher, suffix, status, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET cipher = excluded.cipher, suffix = excluded.suffix, status = excluded.status, updated_at = excluded.updated_at",
          )
          .run(user, cipher, value.slice(-4), "connected", Date.now());
      } else
        this.ctx.db
          .prepare(
            "UPDATE ai_credentials SET status = ?, updated_at = ? WHERE user_id = ?",
          )
          .run("connected", Date.now(), user);
      json(res, 200, this.status(user));
      return true;
    }
    throw new HttpError(404, "Not found");
  }
}
