# DeepFilterNet3, built for the browser

Noise suppression for Podstudio's export, preview and mic check. From
[DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) by Hendrik Schröter,
licensed MIT or Apache-2.0 (both files are here).

- `df.js`, `df_bg.wasm`: `libDF` built with `--features wasm` (wasm-bindgen, `--target web`)
- `DeepFilterNet3_onnx.bin`: the DeepFilterNet3 model, upstream's `models/DeepFilterNet3_onnx.tar.gz`
  byte for byte. It's renamed because servers label `.gz` files as gzip-encoded, and
  the browser would unpack it before the model loader sees it.

Upstream commit `d375b2d8309e0935d165700c91da9de862a99c31`. Rebuild with
`scripts/build-deepfilter.sh`.

It runs at 48 kHz in 480-sample frames, with 1440 samples (30 ms) of delay.
`df_create(model, attenLimDb)` sets how many dB of noise may be removed, which is
Podstudio's fader. A limit of 0 returns NaN, so Podstudio skips the model at 0 %.
The module has no way to free a model (about 10 MB each), so the worker reuses them.
