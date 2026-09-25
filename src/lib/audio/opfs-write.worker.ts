/*
 * Writes a file in the origin private file system with a sync access handle.
 * Used where FileSystemFileHandle.createWritable() doesn't exist (Safari before
 * 26), which only allows writing from a worker. See writeFile() in takes.ts.
 */
interface WriteRequest {
  id: number;
  path: string[];
  name: string;
  data: ArrayBuffer;
}

interface SyncHandle {
  truncate(size: number): void;
  write(data: Uint8Array, opts: { at: number }): number;
  flush(): void;
  close(): void;
}

self.onmessage = async (e: MessageEvent<WriteRequest>) => {
  const { id, path, name, data } = e.data;
  try {
    let dir = await navigator.storage.getDirectory();
    for (const p of path) dir = await dir.getDirectoryHandle(p, { create: true });
    const file = (await dir.getFileHandle(name, { create: true })) as FileSystemFileHandle & {
      createSyncAccessHandle(): Promise<SyncHandle>;
    };
    const h = await file.createSyncAccessHandle();
    h.truncate(0);
    h.write(new Uint8Array(data), { at: 0 });
    h.flush();
    h.close();
    (self as unknown as Worker).postMessage({ id });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error).message || String(err) });
  }
};
