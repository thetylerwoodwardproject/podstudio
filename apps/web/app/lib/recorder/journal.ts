// The local journal: captured chunks are written to IndexedDB *before* they count as
// "saved locally", and kept until the server has verified that chunk (the bytes are then
// dropped, leaving only the tiny meta row, so storage holds just the unverified backlog).
// (IndexedDB rather than OPFS: it is available everywhere the recorder runs, and
// per-chunk transactions are durable.) Write failures — including quota — surface
// as JournalError so the screen can say so instead of silently losing audio.
export interface JournalMeta {
  id: string; // server recording id
  episodeId: string;
  startedAtMs: number;
  sampleRate: number;
  annotations: { type: "retake"; sample: number; atS: number }[];
  /** Samples in chunks that are safely journaled. */
  committedSamples: number;
  /** Samples the capture clock had reached at the last heartbeat (journaled or still in memory). */
  progressSamples: number;
  nextSequence: number;
  updatedAtMs: number;
}

export interface ChunkMeta {
  recordingId: string;
  sequence: number;
  firstSample: number;
  sampleCount: number;
  sha256: string;
  uploaded: boolean;
}

export class JournalError extends Error {}

const DB_NAME = "podstudio-recorder";
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("recordings", { keyPath: "id" });
      db.createObjectStore("chunkMeta", { keyPath: ["recordingId", "sequence"] }).createIndex("byRecording", "recordingId");
      db.createObjectStore("chunkData");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new JournalError(`Can't open the local journal: ${req.error?.message ?? "unknown error"}`));
  });
  return dbPromise;
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new JournalError(tx.error?.name === "QuotaExceededError" ? "The browser's storage is full — free some space; this recording can't be saved locally." : `Local save failed: ${tx.error?.message ?? "unknown error"}`));
    tx.onabort = tx.onerror;
  });

const get = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(new JournalError(r.error?.message ?? "read failed"));
  });

export const journal = {
  async putMeta(meta: JournalMeta) {
    const db = await open();
    const tx = db.transaction("recordings", "readwrite");
    tx.objectStore("recordings").put(meta);
    await done(tx);
  },
  async getMeta(id: string): Promise<JournalMeta | undefined> {
    const db = await open();
    return get(db.transaction("recordings").objectStore("recordings").get(id));
  },
  async listMetas(): Promise<JournalMeta[]> {
    const db = await open();
    return get(db.transaction("recordings").objectStore("recordings").getAll());
  },
  /** Chunk bytes + its meta in one transaction: either both exist or neither does. */
  async putChunk(meta: ChunkMeta, bytes: Uint8Array) {
    const db = await open();
    const tx = db.transaction(["chunkMeta", "chunkData"], "readwrite");
    tx.objectStore("chunkData").put(bytes.slice().buffer, [meta.recordingId, meta.sequence]);
    tx.objectStore("chunkMeta").put(meta);
    await done(tx);
  },
  async listChunks(recordingId: string): Promise<ChunkMeta[]> {
    const db = await open();
    const all = await get(db.transaction("chunkMeta").objectStore("chunkMeta").index("byRecording").getAll(recordingId));
    return (all as ChunkMeta[]).sort((a, b) => a.sequence - b.sequence);
  },
  async getChunkBytes(recordingId: string, sequence: number): Promise<ArrayBuffer | undefined> {
    const db = await open();
    return get(db.transaction("chunkData").objectStore("chunkData").get([recordingId, sequence]));
  },
  async markUploaded(recordingId: string, sequence: number) {
    const db = await open();
    const tx = db.transaction("chunkMeta", "readwrite");
    const store = tx.objectStore("chunkMeta");
    const cur = (await get(store.get([recordingId, sequence]))) as ChunkMeta | undefined;
    if (cur) store.put({ ...cur, uploaded: true });
    await done(tx);
  },
  /** The server has verified this chunk: drop its bytes (keep the meta row) so the journal only holds the backlog. */
  async markUploadedAndDrop(recordingId: string, sequence: number) {
    const db = await open();
    const tx = db.transaction(["chunkMeta", "chunkData"], "readwrite");
    const store = tx.objectStore("chunkMeta");
    const cur = (await get(store.get([recordingId, sequence]))) as ChunkMeta | undefined;
    if (cur) store.put({ ...cur, uploaded: true });
    tx.objectStore("chunkData").delete([recordingId, sequence]);
    await done(tx);
  },
  async deleteRecording(id: string) {
    const db = await open();
    const chunks = await this.listChunks(id);
    const tx = db.transaction(["recordings", "chunkMeta", "chunkData"], "readwrite");
    tx.objectStore("recordings").delete(id);
    for (const c of chunks) {
      tx.objectStore("chunkMeta").delete([id, c.sequence]);
      tx.objectStore("chunkData").delete([id, c.sequence]);
    }
    await done(tx);
  },
};
