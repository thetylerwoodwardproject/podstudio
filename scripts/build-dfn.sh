#!/usr/bin/env bash
# Rebuilds packages/audio/dfn from upstream DeepFilterNet (see packages/audio/dfn/README.md).
# Needs: rustup (stable + wasm32-unknown-unknown target), `cargo install wasm-bindgen-cli --version 0.2.92 --locked`.
set -euo pipefail
COMMIT=d375b2d8309e0935d165700c91da9de862a99c31
OUT="$(cd "$(dirname "$0")/.." && pwd)/packages/audio/dfn"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
git clone https://github.com/Rikorose/DeepFilterNet "$W/src" && git -C "$W/src" checkout "$COMMIT"
git -C "$W/src" apply "$OUT/df-free.patch"
(cd "$W/src/libDF" && cargo build --release --lib --target wasm32-unknown-unknown --no-default-features --features wasm)
wasm-bindgen "$W/src/target/wasm32-unknown-unknown/release/df.wasm" --target web --out-dir "$W/pkg" --no-typescript
cp "$W/pkg/df_bg.wasm" "$OUT/df_bg.wasm"
cp "$W/src/models/DeepFilterNet3_onnx.tar.gz" "$OUT/DeepFilterNet3_onnx.tar.gz"
echo "Rebuilt wasm + model. df.js is hand-patched: copy $W/pkg/df.js over it, then cut the async __wbg_init function and its default export (keep initSync)."
(cd "$OUT" && sha256sum df_bg.wasm DeepFilterNet3_onnx.tar.gz)
