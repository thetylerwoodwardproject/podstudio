"""Chapter markers: parsing, display and the checks Buzzsprout and podcast apps care about."""
from __future__ import annotations

import re


def fmt_time(t: float, tenths: bool = False) -> str:
    """0:00 / 12:34 / 1:02:03 (optionally with tenths)."""
    t = max(0.0, float(t))
    whole = int(t)
    h, m, s = whole // 3600, (whole // 60) % 60, whole % 60
    base = f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
    return base + (f".{int((t - whole) * 10)}" if tenths else "")


def parse_time(text: str) -> float | None:
    """'90', '1:30', '01:30.5', '1:02:03' -> seconds. None if it isn't a time."""
    text = (text or "").strip()
    if not re.fullmatch(r"\d+(:\d{1,2}){0,2}(\.\d+)?", text):
        return None
    parts = [float(p) for p in text.split(":")]
    if len(parts) > 1 and any(p >= 60 for p in parts[1:]):
        return None
    secs = 0.0
    for p in parts:
        secs = secs * 60 + p
    return secs


def normalize(chapters: list[dict], duration: float | None = None) -> tuple[list[dict], list[str]]:
    """What will actually be sent: sorted, titled, inside the episode, starting at 0:00.

    Returns (chapters, notes). notes explain anything that was changed, so nothing happens silently."""
    notes: list[str] = []
    items = sorted(({"t": float(c["t"]), "title": (c.get("title") or "").strip(), **({"url": c["url"]} if c.get("url") else {})}
                    for c in chapters), key=lambda c: c["t"])
    kept = []
    for c in items:
        if not c["title"]:
            notes.append(f"Skipped the chapter at {fmt_time(c['t'])}: it has no title.")
        elif duration and c["t"] >= duration:
            notes.append(f"Skipped “{c['title']}” at {fmt_time(c['t'])}: it starts after the episode ends.")
        elif kept and abs(c["t"] - kept[-1]["t"]) < 1.0:
            notes.append(f"Skipped “{c['title']}”: it is within a second of “{kept[-1]['title']}”.")
        else:
            kept.append(c)
    if kept and kept[0]["t"] > 0.5:
        kept.insert(0, {"t": 0.0, "title": "Intro"})
        notes.append("Added an “Intro” chapter at 0:00. Podcast apps expect the first chapter to start at the beginning.")
    elif kept:
        kept[0]["t"] = 0.0
    return kept, notes
