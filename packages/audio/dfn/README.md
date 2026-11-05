# DeepFilterNet (noise reduction)

Vendored build of [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) (Hendrik Schröter), MIT OR Apache-2.0.

| File | What | SHA-256 |
|---|---|---|
| `df_bg.wasm` | `libDF` compiled to WebAssembly (`--features wasm`, release) with `df-free.patch` applied | `f3596793…c7c1d` |
| `DeepFilterNet3_onnx.tar.gz` | the DeepFilterNet3 model from the same repo (`models/`) | `c94d91f7…3cb6` |
| `df.js` | wasm-bindgen 0.2.92 glue, patched to drop the `import.meta.url` fetch init | |

Source: upstream commit `d375b2d8309e0935d165700c91da9de862a99c31`. Rebuild with `scripts/build-dfn.sh` (needs Rust + `wasm-bindgen-cli 0.2.92`).
The same wasm runs in the browser's AudioWorklet (preview) and in Node (export worker), so both process
identically. Facts we measured: 48 kHz only, hop 480 samples (10 ms), constant 1440-sample (30 ms) delay,
≈ 4.5× real time per channel in Node.

`df-free.patch` adds `df_free`: upstream's wasm API returns a raw pointer from `df_create` but has no way to release it.
