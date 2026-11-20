"""Getting a session back after a crash, a power cut or a damaged session file.

Three layers, so each kind of loss has a way back:
  * the hit journal (audio/events.jsonl) is appended as you record, so a crash loses no hotkey hits;
  * project.json keeps an automatic backup (project.json.bak) of the last good copy;
  * the audio itself is repaired (a killed recording never gets its final WAV header) and the session file is
    rebuilt from what is on disk if nothing else is left.
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .project import DEFAULT_KEYS, PAD_COLORS, SAMPLE_RATE, Event, Pad, Project


class RecoveryError(Exception):
    pass


# ===================================================================== journal
class Journal:
    """Append-only record of hotkey hits while recording. One JSON object per line, flushed to disk each time,
    so a crash can only ever lose a line that was half written."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._f = None

    def start(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._f = open(self.path, "w", encoding="utf-8")

    def _write(self, obj: dict):
        if self._f is None:
            return
        self._f.write(json.dumps(obj) + "\n")
        self._f.flush()
        os.fsync(self._f.fileno())

    def hit(self, index: int, ev: Event):
        self._write({"op": "hit", "i": index, **asdict(ev)})

    def end(self, index: int, dur: float):
        self._write({"op": "end", "i": index, "dur": dur})

    def discard(self):
        """The take finished normally and its events are in project.json: the journal has done its job."""
        if self._f:
            self._f.close()
            self._f = None
        self.path.unlink(missing_ok=True)


def replay(path: Path) -> list[Event]:
    """Rebuild the hit list from a journal. A torn final line (the crash itself) is ignored."""
    events: dict[int, Event] = {}
    try:
        lines = Path(path).read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    for line in lines:
        try:
            o = json.loads(line)
        except ValueError:
            continue
        try:
            if o.get("op") == "hit":
                events[o["i"]] = Event(t=o["t"], pad=o["pad"], clip=o["clip"], gain_db=o.get("gain_db", 0.0),
                                       duck=o.get("duck", False), loop=o.get("loop", False), dur=o.get("dur"))
            elif o.get("op") == "end" and o["i"] in events:
                events[o["i"]].dur = o["dur"]
        except (KeyError, TypeError):
            continue
    return [events[i] for i in sorted(events)]


# ===================================================================== recovery
@dataclass
class Recovery:
    project: Project
    seconds: float
    notes: list[str] = field(default_factory=list)


def _read_json(path: Path):
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) and "name" in data else None
    except (OSError, ValueError):
        return None


def _pretty_name(folder: Path) -> str:
    return folder.name.replace("-", " ").replace("_", " ").strip() or "Recovered session"


def recover(folder: Path) -> Recovery:
    """Repair a session folder in place and return it ready to open. Nothing is ever deleted: a damaged session
    file is renamed aside, and the raw audio is only ever fixed at the header."""
    from .audio import repair_wav_header
    import soundfile as sf

    folder = Path(folder)
    notes: list[str] = []
    pj = folder / "project.json"
    mic = folder / "audio" / "mic.wav"

    data = _read_json(pj)
    if data is None:
        data = _read_json(folder / "project.json.bak")
        if data is not None:
            notes.append("The session file was damaged, so your settings were restored from its automatic backup.")
        if pj.exists():
            aside = pj.with_name(f"project.json.damaged-{time.strftime('%Y%m%d-%H%M%S')}")
            pj.rename(aside)                                   # keep it: it might still be useful to someone
            notes.append(f"The damaged file was kept as {aside.name}.")
    if data is None and not mic.exists():
        raise RecoveryError("There is no session file and no recording in that folder, so there is nothing to recover.")

    if data is not None:
        project = Project.from_dict(folder, data)
    else:
        notes.append("The session file was missing, so it was rebuilt from the audio on disk. Pads and settings are back to defaults.")
        project = Project(name=_pretty_name(folder), root=folder,
                          created=time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(folder.stat().st_mtime)))
        project.pads = [Pad(key=k, color=PAD_COLORS[i % len(PAD_COLORS)]) for i, k in enumerate(DEFAULT_KEYS[:8])]

    # --- the recording
    seconds = 0.0
    if mic.exists() and mic.stat().st_size > 44:
        try:
            seconds = repair_wav_header(mic)                   # a killed recording never got its final sizes
        except ValueError:
            seconds = 0.0
        try:
            seconds = sf.info(str(mic)).duration
        except Exception:
            notes.append("The recording could not be read. It may be damaged beyond repair.")
        if project.recording or data is None:
            notes.append(f"Recovered {int(seconds // 60)}:{int(seconds % 60):02d} of audio.")
        project.mic_duration = seconds
    elif project.recording:
        notes.append("Nothing had been recorded yet.")

    # --- the hotkey hits
    journal = folder / "audio" / "events.jsonl"
    if journal.exists() and (project.recording or not project.events):
        events = [e for e in replay(journal) if e.t <= seconds + 1.0]
        if events:
            project.events = events
            notes.append(f"Restored {len(events)} hotkey hit{'s' if len(events) != 1 else ''} from the journal.")

    # --- pads: when the session file is gone, the hits still say which sound was on which pad
    if data is None and project.events:
        for ev in project.events:
            if 0 <= ev.pad < len(project.pads) and not project.pads[ev.pad].clip:
                project.pads[ev.pad].clip = ev.clip
                project.pads[ev.pad].label = Path(ev.clip).stem[:18]
        clips = {p.clip for p in project.pads}
        loose = [c.name for c in (folder / "clips").glob("*.wav") if c.name not in clips] if (folder / "clips").exists() else []
        if loose:
            notes.append(f"{len(loose)} sound{'s' if len(loose) != 1 else ''} in the clips folder aren't on a pad. Add them from the pad editor.")

    project.recording = False
    project.ensure_dirs()
    project.save()
    if project.events:
        journal.unlink(missing_ok=True)                        # its hits now live in project.json
    return Recovery(project=project, seconds=seconds, notes=notes)
