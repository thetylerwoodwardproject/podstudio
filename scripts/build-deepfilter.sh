#!/bin/sh -e
# Rebuilds public/vendor/deepfilter from upstream DeepFilterNet (MIT or Apache-2.0).
# Needs Rust with the wasm32-unknown-unknown target and wasm-bindgen-cli 0.2.92
# (the version in upstream's Cargo.lock):
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-bindgen-cli --version 0.2.92 --locked
COMMIT=d375b2d8309e0935d165700c91da9de862a99c31
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/vendor/deepfilter"
WORK="$(mktemp -d)"
git clone https://github.com/Rikorose/DeepFilterNet "$WORK/df"
cd "$WORK/df"
git checkout "$COMMIT"
cargo build -p deep_filter --profile release-lto --target wasm32-unknown-unknown --lib --features wasm
wasm-bindgen --target web --remove-name-section --remove-producers-section \
  --out-dir "$OUT" --out-name df target/wasm32-unknown-unknown/release-lto/df.wasm
rm -f "$OUT"/*.d.ts
cp LICENSE-MIT LICENSE-APACHE "$OUT/"
# Renamed so servers don't mark it gzip-encoded (browsers would unpack it on the way).
cp models/DeepFilterNet3_onnx.tar.gz "$OUT/DeepFilterNet3_onnx.bin"
rm -rf "$WORK"
