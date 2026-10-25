import type { ChunkMeta } from "./journal";

// Sends journaled chunks to the server one at a time, idempotently. The server
// re-hashes every chunk, so a retry after a dropped connection is always safe.
// A chunk leaves the "pending" set only when the server answers ok; offline or
// server trouble just means waiting and trying again.
export interface ChunkSource {
  meta: (sequence: number) => Promise<ChunkMeta | undefined>;
  bytes: (sequence: number) => Promise<ArrayBuffer | Uint8Array | undefined>;
}

export interface UploaderEvents {
  /** Called after the server acknowledged the chunk (the owner records it in the journal). */
  onUploaded: (sequence: number) => void | Promise<void>;
  /** A problem retrying can't fix (a conflicting chunk, a rejected recording). */
  onFatal: (message: string) => void;
  onWaiting?: (reason: string | null) => void;
}

export class Uploader {
  private pending: number[] = [];
  private running = false;
  private idleWaiters: (() => void)[] = [];
  private stopped = false;
  fatal: string | null = null;

  constructor(
    private recordingId: string,
    private source: ChunkSource,
    private ev: UploaderEvents,
  ) {}

  enqueue(sequence: number) {
    if (this.pending.includes(sequence)) return;
    this.pending.push(sequence);
    void this.run();
  }

  get queued() {
    return this.pending.length;
  }

  stop() {
    this.stopped = true;
    this.release();
  }

  /** Resolves when every queued chunk is uploaded (or the uploader hit a fatal error / was stopped). */
  drain(): Promise<void> {
    if (!this.running && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private release() {
    for (const w of this.idleWaiters.splice(0)) w();
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    let backoff = 1000;
    while (this.pending.length && !this.stopped && !this.fatal) {
      const seq = this.pending[0]!;
      try {
        const meta = await this.source.meta(seq);
        const bytes = await this.source.bytes(seq);
        if (!meta || !bytes) {
          this.pending.shift();
          continue;
        }
        const res = await fetch(`/studio/recordings/${this.recordingId}/chunks/${seq}`, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream", "X-First-Sample": String(meta.firstSample), "X-Sample-Count": String(meta.sampleCount), "X-Chunk-Sha256": meta.sha256 },
          body: bytes as BodyInit,
        });
        if (res.ok) {
          this.pending.shift();
          backoff = 1000;
          this.ev.onWaiting?.(null);
          await this.ev.onUploaded(seq);
          continue;
        }
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        // 422 = corrupted in transit (retry); 5xx = server trouble (retry); anything else won't fix itself.
        if (res.status === 422 || res.status >= 500) {
          this.ev.onWaiting?.(body?.error ?? `The server answered ${res.status}; retrying…`);
        } else {
          this.fatal = body?.error ?? `The server refused chunk ${seq} (${res.status}).`;
          this.ev.onFatal(this.fatal);
          break;
        }
      } catch {
        this.ev.onWaiting?.(navigator.onLine ? "Can't reach the server; retrying…" : "Offline — audio is safe on this computer and will upload when you're back online.");
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, backoff);
        const on = () => {
          clearTimeout(t);
          resolve();
        };
        window.addEventListener("online", on, { once: true });
        setTimeout(() => window.removeEventListener("online", on), backoff + 50);
      });
      backoff = Math.min(backoff * 2, 15_000);
    }
    this.running = false;
    this.release();
  }
}
