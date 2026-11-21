#!/usr/bin/env bash
# Builds dist/PodStudio-<version>-x86_64.AppImage from this machine's Debian/Ubuntu packages.
# Needs: python3, python3-gi, GTK 4 / libadwaita / GStreamer typelibs, numpy, scipy, soundfile (see the CI workflow).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here"
version="$(python3 -c 'import re; print(re.search(r"__version__ = \"([^\"]+)\"", open("podstudio/__init__.py").read()).group(1))')"
appdir="$here/build/AppDir"

"$here/packaging/fetch-deepfilter.sh" "$here/packaging/vendor"
python3 "$here/packaging/appimage/bundle.py" "$appdir"

echo "Checking the bundle before packing it..."
( cd / && PODSTUDIO_NON_UNIQUE=1 "$appdir/AppRun" --self-test )       # not from the repo: python -m would import the source tree instead of the bundle

# appimagetool, pinned to a release and its published checksum
tool="$here/packaging/vendor/appimagetool-x86_64.AppImage"
TOOL_SHA256=ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0     # appimagetool 1.9.1, from GitHub's release metadata
if ! { [ -f "$tool" ] && echo "$TOOL_SHA256  $tool" | sha256sum -c --status; }; then
  echo "Downloading appimagetool 1.9.1..."
  curl -fL --progress-bar -o "$tool.part" "https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage"
  echo "$TOOL_SHA256  $tool.part" | sha256sum -c --status || { echo "appimagetool checksum mismatch; refusing to run it." >&2; rm -f "$tool.part"; exit 1; }
  mv "$tool.part" "$tool"
fi
chmod +x "$tool"

mkdir -p "$here/dist"
out="$here/dist/PodStudio-$version-x86_64.AppImage"
ARCH=x86_64 "$tool" --no-appstream "$appdir" "$out"
( cd "$here/dist" && sha256sum "$(basename "$out")" > "$(basename "$out").sha256" )
echo "Built dist/$(basename "$out") ($(du -h "$out" | cut -f1))"
