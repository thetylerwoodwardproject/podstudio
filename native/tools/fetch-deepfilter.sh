#!/usr/bin/env bash
# Downloads the official DeepFilterNet command-line tool for Windows (static build, model embedded) and verifies
# it against a pinned checksum. DeepFilterNet is MIT/Apache-2.0: https://github.com/Rikorose/DeepFilterNet
#   usage: fetch-deepfilter.sh [destination-dir]      (default: packaging/vendor)
#
# The checksum below was taken from the v0.5.6 release asset when this build was added (there is no upstream-published
# checksum to compare it with), so it detects a changed or corrupted download, not a malicious original.
set -euo pipefail
VERSION=0.5.6
SHA256=75e11fa16445f560cb6b021521ddb89e89270d13b83089705d98776f58fd7915
URL="https://github.com/Rikorose/DeepFilterNet/releases/download/v${VERSION}/deep-filter-${VERSION}-x86_64-pc-windows-msvc.exe"

dest="${1:-$(cd "$(dirname "$0")/.." && pwd)/vendor}"
mkdir -p "$dest"
bin="$dest/deep-filter.exe"

verify() { [ -f "$1" ] && echo "$SHA256  $1" | sha256sum -c --status; }

if verify "$bin"; then echo "deep-filter.exe $VERSION already present and verified."; exit 0; fi
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
echo "Downloading deep-filter.exe $VERSION (about 27 MB)..."
curl -fL --retry 3 --progress-bar -o "$tmp" "$URL"
if ! verify "$tmp"; then
  echo "Checksum mismatch for the downloaded file. Refusing to use it." >&2
  exit 1
fi
install -m755 "$tmp" "$bin"
echo "Downloaded and verified: $bin"
