#!/usr/bin/env bash
# Installs PodStudio for the current user (no sudo). Re-run to upgrade.
#   ./install.sh                  install (also fetches the DeepFilterNet noise-reduction tool, about 36 MB)
#   ./install.sh --no-deepfilter  install without noise reduction
#   ./install.sh --uninstall      remove this per-user install (use after installing the .deb)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
prefix="${PODSTUDIO_PREFIX:-$HOME/.local}"
id=io.github.thetylerwoodwardproject.PodStudio

refresh_caches() {
  command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -qtf "$prefix/share/icons/hicolor" 2>/dev/null || true
  command -v update-desktop-database >/dev/null && update-desktop-database "$prefix/share/applications" 2>/dev/null || true
}

if [ "${1:-}" = "--uninstall" ]; then
  rm -f  "$prefix/bin/podstudio" "$prefix/share/applications/$id.desktop" "$prefix/share/metainfo/$id.metainfo.xml"
  rm -rf "$prefix/share/podstudio"
  find "$prefix/share/icons" -name "$id.*" -delete 2>/dev/null || true
  refresh_caches
  echo "Removed the per-user PodStudio install. Your sessions in ~/Music/PodStudio and settings in ~/.config/podstudio were left alone."
  exit 0
fi

python3 -c 'import gi; gi.require_version("Gtk","4.0"); gi.require_version("Adw","1"); gi.require_version("Gst","1.0")' 2>/dev/null \
  || { echo "Missing GUI packages. Run: sudo apt install python3-gi gir1.2-gtk-4.0 gir1.2-adw-1 gir1.2-gstreamer-1.0 gstreamer1.0-plugins-good gstreamer1.0-pulseaudio" >&2; exit 1; }

venv="$prefix/share/podstudio/venv"
mkdir -p "$prefix/share/podstudio" "$prefix/bin"
if command -v uv >/dev/null; then
  uv venv --system-site-packages -q "$venv"
  uv pip install -q --python "$venv/bin/python" "$here"
else
  python3 -m venv --system-site-packages "$venv" || { echo "Install python3-venv (or uv) and retry." >&2; exit 1; }
  "$venv/bin/pip" install -q "$here"
fi

if [ "${1:-}" != "--no-deepfilter" ]; then
  "$here/packaging/fetch-deepfilter.sh" "$prefix/share/podstudio/bin" \
    || echo "Noise reduction is unavailable (could not fetch DeepFilterNet). Everything else works." >&2
fi

printf '#!/bin/sh\nexec "%s/bin/python" -m podstudio "$@"\n' "$venv" > "$prefix/bin/podstudio"
chmod +x "$prefix/bin/podstudio"

for png in "$here"/data/icons/hicolor/*/apps/$id.png; do
  size="$(basename "$(dirname "$(dirname "$png")")")"
  install -Dm644 "$png" "$prefix/share/icons/hicolor/$size/apps/$id.png"
done
install -Dm644 "$here/data/$id.svg" "$prefix/share/icons/hicolor/scalable/apps/$id.svg"
# COSMIC and some other desktops ignore an icon theme dir with no index.theme
icons="$prefix/share/icons/hicolor"
if [ ! -f "$icons/index.theme" ] && [ -f /usr/share/icons/hicolor/index.theme ]; then cp /usr/share/icons/hicolor/index.theme "$icons/index.theme"; fi
sed "s|@EXEC@|$prefix/bin/podstudio|" "$here/data/$id.desktop" > "$prefix/share/applications.tmp"
install -Dm644 "$prefix/share/applications.tmp" "$prefix/share/applications/$id.desktop" && rm "$prefix/share/applications.tmp"
install -Dm644 "$here/data/$id.metainfo.xml" "$prefix/share/metainfo/$id.metainfo.xml"
refresh_caches

echo "Installed. Launch with: podstudio   (or from your app launcher)"
echo
echo "Optional, for the PodMic's on-board processing controls (one-time, needs sudo):"
echo "  sudo install -m644 $here/data/70-podstudio-podmic.rules /etc/udev/rules.d/ && sudo udevadm control --reload && sudo udevadm trigger --subsystem-match=hidraw"
