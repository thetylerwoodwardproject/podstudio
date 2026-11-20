#!/usr/bin/env bash
# Builds dist/podstudio_<version>_amd64.deb (bundles the verified DeepFilterNet binary).
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here"
version="$(python3 -c 'import re,sys; print(re.search(r"__version__ = \"([^\"]+)\"", open("podstudio/__init__.py").read()).group(1))')"
id=io.github.thetylerwoodwardproject.PodStudio
rev="$(cat "$here/packaging/revision" 2>/dev/null || echo 1)"
debver="$version-$rev"             # upstream version (a date) plus the package revision, so apt sees rebuilds as upgrades
pkg="podstudio_${debver}_amd64"
root="$here/build/deb/$pkg"
rm -rf "$root"; mkdir -p "$root"/{DEBIAN,usr/bin,usr/lib/podstudio/bin,usr/lib/udev/rules.d,usr/share/{applications,metainfo,doc/podstudio}}

"$here/packaging/fetch-deepfilter.sh" "$here/packaging/vendor"

# application (no bytecode: it is compiled on the target by postinst)
cp -r podstudio "$root/usr/lib/podstudio/podstudio"
find "$root/usr/lib/podstudio" -name __pycache__ -type d -prune -exec rm -rf {} +
install -m755 packaging/vendor/deep-filter "$root/usr/lib/podstudio/bin/deep-filter"
cat > "$root/usr/bin/podstudio" <<'L'
#!/bin/sh
exec env PYTHONPATH=/usr/lib/podstudio${PYTHONPATH:+:$PYTHONPATH} python3 -m podstudio "$@"
L
chmod 755 "$root/usr/bin/podstudio"

# desktop integration
sed 's|@EXEC@|podstudio|' "data/$id.desktop" > "$root/usr/share/applications/$id.desktop"
install -Dm644 "data/$id.metainfo.xml" "$root/usr/share/metainfo/$id.metainfo.xml"
install -Dm644 "data/$id.svg" "$root/usr/share/icons/hicolor/scalable/apps/$id.svg"
for png in data/icons/hicolor/*/apps/$id.png; do
  size="$(basename "$(dirname "$(dirname "$png")")")"
  install -Dm644 "$png" "$root/usr/share/icons/hicolor/$size/apps/$id.png"
done
install -m644 data/70-podstudio-podmic.rules "$root/usr/lib/udev/rules.d/70-podstudio-podmic.rules"

# docs and licences
d="$root/usr/share/doc/podstudio"
install -m644 README.md "$d/README.md"
install -m644 NOTICE "$d/NOTICE"
install -m644 packaging/licenses/DeepFilterNet-LICENSE-MIT "$d/DeepFilterNet-LICENSE-MIT"
install -m644 packaging/licenses/DeepFilterNet-LICENSE-APACHE "$d/DeepFilterNet-LICENSE-APACHE"
maint="The Tyler Woodward Project <15947417+thetylerwoodwardproject@users.noreply.github.com>"
cat > "$d/copyright" <<C
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: PodStudio
Source: https://github.com/thetylerwoodwardproject/podstudio

Files: *
Copyright: 2026 The Tyler Woodward Project
License: MIT

Files: usr/lib/podstudio/podstudio/data/podmic-dsp-tables.json usr/lib/podstudio/podstudio/podmic.py
Copyright: 2026 rumkit (protocol research: https://github.com/rumkit/podmicusb-doctor)
License: MIT

Files: usr/lib/podstudio/bin/deep-filter
Copyright: Hendrik Schröter and DeepFilterNet contributors (https://github.com/Rikorose/DeepFilterNet)
License: MIT or Apache-2.0
 The unmodified upstream release binary. Licence texts: DeepFilterNet-LICENSE-MIT and DeepFilterNet-LICENSE-APACHE.

License: MIT
 Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
 to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 .
 The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 the Software.
 .
 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
 THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
 CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 IN THE SOFTWARE.

PodStudio is not affiliated with, endorsed by, or sponsored by RØDE Microphones.
C
{ printf 'podstudio (%s) unstable; urgency=low\n\n  * Release v%s.\n\n -- %s  %s\n' "$debver" "$version" "$maint" "$(date -R)"; } | gzip -9n > "$d/changelog.gz"

# maintainer scripts
cat > "$root/DEBIAN/postinst" <<'S'
#!/bin/sh
set -e
if [ "$1" = configure ]; then
  python3 -m compileall -q /usr/lib/podstudio/podstudio >/dev/null 2>&1 || true
  if command -v udevadm >/dev/null 2>&1; then
    udevadm control --reload >/dev/null 2>&1 || true
    udevadm trigger --subsystem-match=hidraw >/dev/null 2>&1 || true   # lets the PodMic controls work without a replug
  fi
  command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor >/dev/null 2>&1 || true
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications >/dev/null 2>&1 || true
fi
exit 0
S
cat > "$root/DEBIAN/postrm" <<'S'
#!/bin/sh
set -e
case "$1" in
  remove|purge)
    rm -rf /usr/lib/podstudio/podstudio/__pycache__
    rmdir /usr/lib/podstudio/podstudio /usr/lib/podstudio/bin /usr/lib/podstudio 2>/dev/null || true
    command -v udevadm >/dev/null 2>&1 && udevadm control --reload >/dev/null 2>&1 || true
    command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor >/dev/null 2>&1 || true
    ;;
esac
exit 0
S
chmod 755 "$root/DEBIAN/postinst" "$root/DEBIAN/postrm"

# Debian policy: directories 755, files 644 (executables 755), independent of the builder's umask
find "$root" -type d -exec chmod 755 {} +
find "$root" -type f ! -perm /111 -exec chmod 644 {} +

size_kb="$(du -sk "$root" | cut -f1)"
cat > "$root/DEBIAN/control" <<C
Package: podstudio
Version: $debver
Section: sound
Priority: optional
Architecture: amd64
Maintainer: $maint
Installed-Size: $size_kb
Depends: python3 (>= 3.10), python3-gi, gir1.2-gtk-4.0, gir1.2-adw-1 (>= 1.5), gir1.2-gstreamer-1.0, gir1.2-secret-1, gstreamer1.0-plugins-base, gstreamer1.0-plugins-good, python3-numpy, python3-scipy, python3-soundfile, libsndfile1 (>= 1.1), alsa-utils, pulseaudio-utils
Recommends: gnome-keyring | kwalletmanager
Homepage: https://github.com/thetylerwoodwardproject/podstudio
Description: Recording console for the RØDE PodMic USB
 Record the PodMic USB, fire hotkey sounds from pads onto their own track, and export a stereo
 master normalized to podcast loudness (-16 LUFS, true peak at or below -1 dBTP).
 .
 Features: on-board PodMic processing controls over USB, DeepFilterNet noise reduction at
 render time, per-pad ducking, MP3 export, and upload to Buzzsprout as a private draft.
 .
 Independent project. Not affiliated with, endorsed by, or sponsored by RØDE Microphones.
C
( cd "$root" && find usr -type f -print0 | sort -z | xargs -0 md5sum > DEBIAN/md5sums )

mkdir -p "$here/dist"
dpkg-deb --root-owner-group -Zxz --build "$root" "$here/dist/$pkg.deb" >/dev/null
echo "Built dist/$pkg.deb ($(du -h "$here/dist/$pkg.deb" | cut -f1))"
