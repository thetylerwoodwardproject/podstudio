// Builds the DfnRuntime that fx.ts consumes from the wasm-bindgen glue (../dfn/df.js). Runtime-agnostic:
// the caller supplies the compiled module (or its bytes) and the model bytes, so the browser's
// AudioWorklet and the Node export worker run the very same code on the very same files.
import * as glue from "../dfn/df.js";
import { DFN_HOP, type DfnRuntime, type DfnInstance } from "./fx";

export function createDfnRuntime(wasm: WebAssembly.Module | BufferSource, model: Uint8Array): DfnRuntime {
  glue.initSync(wasm);
  // Building a model takes ≈ 0.5 s, which on an audio thread is a dropout: prepare() builds them while idle.
  // A pooled instance has never run, so it is exactly a fresh one.
  const pool: number[] = [];
  const build = (): number => {
    const ptr: number = glue.df_create(model, 0);
    if (glue.df_get_frame_length(ptr) !== DFN_HOP) {
      glue.df_free(ptr);
      throw new Error("Unexpected DeepFilterNet frame size");
    }
    return ptr;
  };
  return {
    prepare(count: number) {
      while (pool.length < count) pool.push(build());
    },
    create(attenLimitDb: number): DfnInstance {
      const ptr = pool.pop() ?? build();
      glue.df_set_atten_lim(ptr, attenLimitDb);
      let freed = false;
      return {
        process: (frame) => glue.df_process_frame(ptr, frame) as Float32Array,
        setAttenLimit: (db) => glue.df_set_atten_lim(ptr, db),
        free() {
          if (!freed) {
            freed = true;
            glue.df_free(ptr);
          }
        },
      };
    },
  };
}
