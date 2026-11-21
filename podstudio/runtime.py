"""How PodStudio is packaged and where it is running (deb, Flatpak, AppImage or plain source).

Each format changes what is possible: sandboxed formats update through their own store, can't run host tools such as
pactl, and keep their bundled files in different places. Everything that depends on that asks this module.
"""
from __future__ import annotations

import os
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent          # <prefix>/lib/podstudio in every packaged layout


def kind() -> str:
    """'flatpak', 'appimage', 'deb' or 'source'."""
    if os.environ.get("FLATPAK_ID") or Path("/.flatpak-info").exists():
        return "flatpak"
    if os.environ.get("APPIMAGE") and os.environ.get("APPDIR"):
        return "appimage"
    if str(PACKAGE_ROOT).startswith("/usr/lib/podstudio"):
        return "deb"
    return "source"


def sandboxed() -> bool:
    return kind() == "flatpak"


def updates_enabled() -> bool:
    """Flatpak is updated by its store. Everything else may check GitHub for a newer release."""
    return not sandboxed()


def bundled(*parts: str) -> Path | None:
    """A file shipped with the app, e.g. bundled('bin', 'deep-filter'), or None if this build doesn't have it."""
    p = PACKAGE_ROOT.joinpath(*parts)
    return p if p.exists() else None


def describe() -> str:
    return {"flatpak": "Flatpak", "appimage": "AppImage", "deb": "the .deb package",
            "source": "a source checkout"}[kind()]
