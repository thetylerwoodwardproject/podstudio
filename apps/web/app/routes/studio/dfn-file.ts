import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// The DeepFilterNet wasm and model for the editor's preview (packages/audio/dfn). The files never change
// without a rebuild, so they are cached hard; the page asks with ?v=<version> to bust that on an upgrade.
const FILES: Record<string, string> = { "df_bg.wasm": "application/wasm", "DeepFilterNet3_onnx.tar.gz": "application/octet-stream" };
const cache = new Map<string, Promise<Buffer>>();
const dir = () => process.env.PODSTUDIO_DFN_DIR ?? resolve(process.cwd(), "../../packages/audio/dfn");

export async function loader({ params }: { params: { file?: string } }) {
  const name = params.file ?? "";
  const type = FILES[name];
  if (!type) return new Response("Not found", { status: 404 });
  let p = cache.get(name);
  if (!p) cache.set(name, (p = readFile(join(dir(), name))));
  try {
    return new Response(new Uint8Array(await p), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=31536000, immutable" } });
  } catch {
    cache.delete(name);
    return new Response("Not found", { status: 404 });
  }
}
