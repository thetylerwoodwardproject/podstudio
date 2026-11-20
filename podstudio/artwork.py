"""Episode cover art: validation and import into the session folder. Uses GdkPixbuf only to read the header."""
from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from pathlib import Path

import gi

gi.require_version("GdkPixbuf", "2.0")
from gi.repository import GdkPixbuf, GLib  # noqa: E402

from .buzzsprout import MAX_ART_BYTES  # noqa: E402

# Apple Podcasts' cover-art spec, which Buzzsprout follows for its feed: square, 1400 to 3000 px, JPEG or PNG
MIN_PX, MAX_PX = 1400, 3000


@dataclass
class ArtInfo:
    ok: bool
    width: int = 0
    height: int = 0
    fmt: str = ""
    size: int = 0
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def summary(self) -> str:
        return f"{self.width} × {self.height} {self.fmt.upper()} · {self.size / 1e6:.1f} MB" if self.width else ""


def inspect(path: Path) -> ArtInfo:
    path = Path(path)
    info = ArtInfo(ok=False)
    try:
        info.size = path.stat().st_size
        fmt, w, h = GdkPixbuf.Pixbuf.get_file_info(str(path))
    except (OSError, GLib.Error):
        fmt = None
    if fmt is None:
        info.errors.append("That file isn't an image PodStudio can read.")
        return info
    info.fmt, info.width, info.height = fmt.get_name(), w, h
    if info.fmt not in ("png", "jpeg"):
        info.errors.append(f"Use a JPEG or PNG. This is {info.fmt.upper()}.")
    if info.size > MAX_ART_BYTES:
        info.errors.append(f"The file is {info.size / 1e6:.0f} MB; the limit is {MAX_ART_BYTES // 1_000_000} MB.")
    if w != h:
        info.warnings.append(f"It isn't square ({w} × {h}). Podcast apps crop or distort non-square art.")
    if min(w, h) < MIN_PX:
        info.warnings.append(f"Podcast directories want at least {MIN_PX} × {MIN_PX} px. This is {w} × {h}.")
    if max(w, h) > MAX_PX:
        info.warnings.append(f"Podcast directories want at most {MAX_PX} × {MAX_PX} px. This is {w} × {h}.")
    info.ok = not info.errors
    return info


def import_art(project, src: Path) -> Path:
    """Copy the chosen image into the session (art/cover.<ext>) so the session stays self-contained."""
    info = inspect(src)
    if not info.ok:
        raise ValueError(" ".join(info.errors))
    ext = ".png" if info.fmt == "png" else ".jpg"
    dest_dir = project.root / "art"
    dest_dir.mkdir(parents=True, exist_ok=True)
    for old in dest_dir.glob("cover.*"):
        old.unlink()
    dest = dest_dir / f"cover{ext}"
    shutil.copy2(src, dest)
    project.art = f"art/{dest.name}"
    return dest
