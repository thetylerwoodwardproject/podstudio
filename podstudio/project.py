"""Project folders: separate mic and hotkey stems plus a normalized master."""
from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

SAMPLE_RATE = 48000
DEFAULT_ROOT = Path.home() / "Music" / "PodStudio"
PAD_COLORS = ["#ff5c7a", "#ffb454", "#f2e35c", "#5cff9d", "#4fd8eb", "#6ea8ff", "#b48bff", "#ff7ad9"]
DEFAULT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "q", "w"]


@dataclass
class Pad:
    key: str
    label: str = ""
    clip: str = ""            # file name inside <project>/clips
    color: str = "#6ea8ff"
    gain_db: float = 0.0
    loop: bool = False
    duck: bool = False        # lower this pad's sound while the mic is speaking


@dataclass
class Event:
    t: float                  # seconds since the mic stream started
    pad: int                  # index into Project.pads
    clip: str
    gain_db: float = 0.0
    duck: bool = False


@dataclass
class Project:
    name: str
    root: Path
    mic_db: float = 0.0
    hotkeys_db: float = 0.0
    hotkeys_muted: bool = False
    target_lufs: float = -16.0
    pads: list[Pad] = field(default_factory=list)
    events: list[Event] = field(default_factory=list)
    created: str = ""
    mic_duration: float = 0.0
    mix_stats: dict = field(default_factory=dict)
    denoise: bool = True               # DeepFilterNet noise reduction when rendering the master
    denoise_atten_db: float = 18.0     # strength: maximum attenuation in dB
    duck_amount_db: float = 12.0       # how far ducked pads dip
    duck_threshold_db: float = -40.0   # mic level (dBFS RMS) that counts as speaking
    duck_release_ms: float = 350.0     # how fast they come back
    clean_key: str = ""                # identifies the take + strength that mic-clean.wav was made from

    # layout ---------------------------------------------------------------
    @property
    def audio_dir(self) -> Path: return self.root / "audio"
    @property
    def clips_dir(self) -> Path: return self.root / "clips"
    @property
    def mic_path(self) -> Path: return self.audio_dir / "mic.wav"
    @property
    def clean_path(self) -> Path: return self.audio_dir / "mic-clean.wav"
    @property
    def hotkeys_path(self) -> Path: return self.audio_dir / "hotkeys.wav"
    @property
    def master_path(self) -> Path: return self.audio_dir / "master.wav"
    @property
    def mp3_path(self) -> Path: return self.audio_dir / "episode.mp3"
    @property
    def file(self) -> Path: return self.root / "project.json"

    def ensure_dirs(self):
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        self.clips_dir.mkdir(parents=True, exist_ok=True)

    # persistence ------------------------------------------------------------
    def save(self):
        self.ensure_dirs()
        data = {
            "format": 1,
            "name": self.name,
            "created": self.created,
            "mic_db": self.mic_db,
            "hotkeys_db": self.hotkeys_db,
            "hotkeys_muted": self.hotkeys_muted,
            "target_lufs": self.target_lufs,
            "mic_duration": self.mic_duration,
            "mix_stats": self.mix_stats,
            "denoise": self.denoise,
            "denoise_atten_db": self.denoise_atten_db,
            "clean_key": self.clean_key,
            "duck_amount_db": self.duck_amount_db,
            "duck_threshold_db": self.duck_threshold_db,
            "duck_release_ms": self.duck_release_ms,
            "pads": [asdict(p) for p in self.pads],
            "events": [asdict(e) for e in self.events],
        }
        tmp = self.file.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2))
        tmp.replace(self.file)

    @classmethod
    def load(cls, root: Path) -> "Project":
        d = json.loads((Path(root) / "project.json").read_text())
        return cls(
            name=d["name"], root=Path(root), mic_db=d.get("mic_db", 0.0),
            hotkeys_db=d.get("hotkeys_db", 0.0), hotkeys_muted=d.get("hotkeys_muted", False), target_lufs=d.get("target_lufs", -16.0),
            created=d.get("created", ""), mic_duration=d.get("mic_duration", 0.0), mix_stats=d.get("mix_stats", {}), denoise=d.get("denoise", False),
            denoise_atten_db=d.get("denoise_atten_db", 18.0), clean_key=d.get("clean_key", ""),
            duck_amount_db=d.get("duck_amount_db", 12.0), duck_threshold_db=d.get("duck_threshold_db", -40.0),
            duck_release_ms=d.get("duck_release_ms", 350.0),
            pads=[Pad(**p) for p in d.get("pads", [])],
            events=[Event(**e) for e in d.get("events", [])],
        )

    @classmethod
    def create(cls, name: str, parent: Path = DEFAULT_ROOT) -> "Project":
        slug = re.sub(r"[^\w.-]+", "-", name.strip()).strip("-") or "session"
        root = Path(parent) / slug
        n = 2
        while root.exists():
            root = Path(parent) / f"{slug}-{n}"
            n += 1
        p = cls(name=name.strip() or slug, root=root, created=time.strftime("%Y-%m-%d %H:%M:%S"))
        p.pads = [Pad(key=k, color=PAD_COLORS[i % len(PAD_COLORS)]) for i, k in enumerate(DEFAULT_KEYS[:8])]
        p.save()
        return p

    def carry_over(self, other: "Project"):
        """Take the mixing and cleanup settings of another session (a new take starts from the last one)."""
        for k in ("mic_db", "hotkeys_db", "hotkeys_muted", "target_lufs", "denoise", "denoise_atten_db",
                  "duck_amount_db", "duck_threshold_db", "duck_release_ms"):
            setattr(self, k, getattr(other, k))

    def has_recording(self) -> bool:
        return self.mic_path.exists() and self.mic_path.stat().st_size > 44
