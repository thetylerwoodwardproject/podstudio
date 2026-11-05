// Node side: load DeepFilterNet from packages/audio/dfn and register it with the FX engine.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDfnRuntime } from "./dfn-runtime";
import { dfnReady, setDfnRuntime } from "./fx";

const dir = (f: string) => fileURLToPath(new URL(`../dfn/${f}`, import.meta.url));
let loading: Promise<void> | null = null;

/** Idempotent. Resolves once noise reduction is available to every FxChain in this process. */
export function ensureDfnLoaded(): Promise<void> {
  if (dfnReady()) return Promise.resolve();
  loading ??= (async () => {
    const [wasm, model] = await Promise.all([readFile(dir("df_bg.wasm")), readFile(dir("DeepFilterNet3_onnx.tar.gz"))]);
    setDfnRuntime(createDfnRuntime(wasm, new Uint8Array(model)));
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}
