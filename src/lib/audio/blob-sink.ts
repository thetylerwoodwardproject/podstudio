/** Disk-backed output in browsers; test environments retain the small Blob fallback. */
export async function blobSink(type = "audio/wav") {
  let file: FileSystemFileHandle | undefined,
    writer: FileSystemWritableFileStream | undefined;
  let dir: FileSystemDirectoryHandle | undefined;
  const name = crypto.randomUUID();
  const parts: BlobPart[] = [];
  if (typeof navigator !== "undefined" && navigator.storage?.getDirectory) {
    const root = await navigator.storage.getDirectory();
    dir = await root.getDirectoryHandle("prepared-cache", { create: true });
    for await (const [entry, handle] of (
      dir as FileSystemDirectoryHandle & {
        entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
      }
    ).entries()) {
      if (
        handle.kind === "file" &&
        (await (handle as FileSystemFileHandle).getFile()).lastModified <
          Date.now() - 86400000
      )
        await dir.removeEntry(entry).catch(() => {});
    }
    file = await dir.getFileHandle(name, { create: true });
    writer = await file.createWritable();
  }
  return {
    async write(bytes: Uint8Array) {
      if (writer) await writer.write(bytes as Uint8Array<ArrayBuffer>);
      else parts.push(bytes.slice() as BlobPart);
    },
    async finish(header?: Uint8Array) {
      if (writer) {
        if (header) {
          await writer.seek(0);
          await writer.write(header as Uint8Array<ArrayBuffer>);
        }
        await writer.close();
        return file!.getFile();
      }
      if (header) parts[0] = header as BlobPart;
      return new Blob(parts, { type });
    },
    async abort() {
      await writer?.abort().catch(() => {});
      if (dir) await dir.removeEntry(name).catch(() => {});
    },
  };
}
