#!/usr/bin/env bash
# Builds the Windows version of PodStudio into dist/PodStudio-<version>/ and a portable zip next to it.
# Run it from an MSYS2 UCRT64 shell on Windows (CI does this; see packaging/ci/packages.yml). The setup program
# is made from that folder afterwards with Inno Setup (build-windows.ps1 does both steps).
#
# One-time setup, in an MSYS2 UCRT64 shell:
#   pacman -S --needed mingw-w64-ucrt-x86_64-{gcc,pkgconf,ntldd,python,python-pip,python-gobject,python-cffi,python-numpy,python-scipy,python-soundfile} \
#     mingw-w64-ucrt-x86_64-{gtk4,libadwaita,librsvg,adwaita-icon-theme,hicolor-icon-theme,libsndfile,hidapi,ca-certificates} \
#     mingw-w64-ucrt-x86_64-{gstreamer,gst-plugins-base,gst-plugins-good,gst-plugins-bad,gst-plugins-ugly} unzip zip
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$here"

version="$(python -c 'import re; print(re.search(r"__version__ = \"([^\"]+)\"", open("podstudio/__init__.py").read()).group(1))')"
rev="$(cat packaging/revision 2>/dev/null || echo 1)"
full="$version-$rev"
build="$here/build/windows"
out="$here/dist/PodStudio-$full"
echo "== PodStudio $full for Windows"

mkdir -p "$build" "$here/dist"

echo "== Pure-Python dependencies (input gain through the Windows audio API)"
python -m pip install --quiet --no-deps --upgrade --target "$build/pydeps" comtypes pycaw

echo "== Launcher"
pyv="$(python -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
if pkg-config --exists "python-$pyv-embed"; then flags="$(pkg-config --cflags --libs "python-$pyv-embed")"
else flags="$(python3-config --cflags --ldflags --embed)"; fi
windres packaging/windows/podstudio.rc -O coff -o "$build/podstudio.res"
# shellcheck disable=SC2086
gcc -O2 -Wall -municode -mwindows packaging/windows/launcher.c "$build/podstudio.res" -o "$build/PodStudio.exe" $flags
# shellcheck disable=SC2086
gcc -O2 -Wall -municode -mconsole -DCONSOLE_APP packaging/windows/launcher.c "$build/podstudio.res" -o "$build/PodStudio-console.exe" $flags

echo "== DeepFilterNet (noise reduction)"
packaging/windows/fetch-deepfilter.sh "$here/packaging/vendor"

echo "== Bundle"
python packaging/windows/bundle.py "$out" --version "$full" --build-dir "$build" --pydeps "$build/pydeps"

echo "== Self-test of the bundle (it must pass with no MSYS2 on PATH)"
PATH="/c/Windows/System32:/c/Windows" "$out/bin/PodStudio-console.exe" --self-test

echo "== Portable zip"
rm -f "$here/dist/PodStudio-$full-x64-portable.zip"
(cd "$here/dist" && zip -qr "PodStudio-$full-x64-portable.zip" "PodStudio-$full")
(cd "$here/dist" && sha256sum "PodStudio-$full-x64-portable.zip" > "PodStudio-$full-x64-portable.zip.sha256")
echo "$full" > "$build/version.txt"
echo "Done: $out"
