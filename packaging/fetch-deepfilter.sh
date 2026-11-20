#!/usr/bin/env bash
# Downloads the official DeepFilterNet command-line tool (static x86_64 Linux build, model embedded)
# and verifies it against a pinned checksum. DeepFilterNet is MIT/Apache-2.0: https://github.com/Rikorose/DeepFilterNet
#   usage: fetch-deepfilter.sh [destination-dir]      (default: packaging/vendor)
set -euo pipefail
VERSION=0.5.6
SHA256=70775e251eee44c0f2451a1e833326cf8bcbbe304d3e7cd12851e6fce72ef7da
URL="https://github.com/Rikorose/DeepFilterNet/releases/download/v${VERSION}/deep-filter-${VERSION}-x86_64-unknown-linux-musl"

dest="${1:-$(cd "$(dirname "$0")" && pwd)/vendor}"
mkdir -p "$dest"
bin="$dest/deep-filter"

verify() { [ -f "$bin" ] && echo "$SHA256  $bin" | sha256sum -c --status; }

if verify; then echo "deep-filter $VERSION already present and verified."; exit 0; fi
[ "$(uname -m)" = x86_64 ] || { echo "This build is for x86_64; skipping noise reduction." >&2; exit 2; }

tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
echo "Downloading deep-filter $VERSION (about 36 MB)..."
curl -fL --progress-bar -o "$tmp" "$URL"
if ! echo "$SHA256  $tmp" | sha256sum -c --status; then
  echo "Checksum mismatch for the downloaded file. Refusing to install it." >&2
  exit 1
fi
install -m755 "$tmp" "$bin"
echo "Installed and verified: $bin"
