"""How PodStudio is packaged and where it is running (deb, Flatpak, AppImage, Windows installer or plain source).

Each format changes what is possible: sandboxed formats update through their own store, can't run host tools such as
pactl, and keep their bundled files in different places. Everything that depends on that asks this module.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent          # <prefix>/lib/podstudio in every packaged layout
IS_WINDOWS = sys.platform == "win32"


def windows_home() -> Path | None:
    """Folder of the Windows build (the one holding PodStudio.exe's `bin`), set by the launcher. None elsewhere."""
    home = os.environ.get("PODSTUDIO_HOME")
    return Path(home) if IS_WINDOWS and home else None


def kind() -> str:
    """'flatpak', 'appimage', 'deb', 'windows' or 'source'."""
    if os.environ.get("FLATPAK_ID") or Path("/.flatpak-info").exists():
        return "flatpak"
    if os.environ.get("APPIMAGE") and os.environ.get("APPDIR"):
        return "appimage"
    if windows_home() is not None:
        return "windows"
    if str(PACKAGE_ROOT).startswith("/usr/lib/podstudio"):
        return "deb"
    return "source"


def sandboxed() -> bool:
    return kind() == "flatpak"


def updates_enabled() -> bool:
    """Flatpak is updated by its store. Everything else may check GitHub for a newer release."""
    return not sandboxed()


def bundled(*parts: str) -> Path | None:
    """A file shipped with the app, e.g. bundled('bin', 'deep-filter'), or None if this build doesn't have it.

    The Windows build keeps its tools in <install>\\bin and gives them an .exe suffix."""
    roots = [PACKAGE_ROOT]
    home = windows_home()
    if home is not None:
        roots.insert(0, home)
    for root in roots:
        for suffix in ("", ".exe") if IS_WINDOWS else ("",):
            p = root.joinpath(*parts[:-1], parts[-1] + suffix)
            if p.exists():
                return p
    return None


def user_cache_dir() -> Path:
    """Where downloads and other throw-away files go."""
    if IS_WINDOWS:
        return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "PodStudio"
    return Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "podstudio"


def describe() -> str:
    return {"flatpak": "Flatpak", "appimage": "AppImage", "deb": "the .deb package", "windows": "the Windows build",
            "source": "a source checkout"}[kind()]
