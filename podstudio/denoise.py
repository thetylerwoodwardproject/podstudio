"""Offline noise reduction with DeepFilterNet (https://github.com/Rikorose/DeepFilterNet, MIT/Apache-2.0).

Runs the upstream `deep-filter` command-line tool (a single static binary with the model embedded) on the mic
stem while the master is rendered. It is far too heavy to run live, but processes audio roughly ten times
faster than real time. The raw mic stem is never modified; the cleaned copy is saved next to it.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

from .project import SAMPLE_RATE, Project

ATTEN_MIN, ATTEN_MAX, ATTEN_DEFAULT = 6.0, 40.0, 18.0     # dB of maximum noise attenuation


class DenoiseError(Exception):
    pass


def find_binary() -> Path | None:
    """Bundled copy first (the .deb installs one), then a per-user copy, then $PATH."""
    candidates = [os.environ.get("PODSTUDIO_DEEPFILTER", ""), "/usr/lib/podstudio/bin/deep-filter",
                  str(Path.home() / ".local/share/podstudio/bin/deep-filter"), shutil.which("deep-filter") or ""]
    for c in candidates:
        if c and os.access(c, os.X_OK) and Path(c).is_file():
            return Path(c)
    return None


def available() -> bool:
    return find_binary() is not None


def denoise(src: Path, dst: Path, atten_db: float = ATTEN_DEFAULT, binary: Path | None = None,
            timeout: float = 3600.0) -> None:
    """Write a noise-reduced copy of src to dst (same length, 48 kHz, 24-bit)."""
    binary = binary or find_binary()
    if binary is None:
        raise DenoiseError("DeepFilterNet (deep-filter) is not installed")
    data, rate = sf.read(str(src), dtype="float32", always_2d=True)
    if rate != SAMPLE_RATE:
        raise DenoiseError(f"expected {SAMPLE_RATE} Hz audio, got {rate}")
    with tempfile.TemporaryDirectory(prefix="podstudio-dfn-") as td:
        tdp = Path(td)
        inp, outdir = tdp / "in.wav", tdp / "out"
        outdir.mkdir()
        # deep-filter's WAV reader rejects 24-bit files; 32-bit float carries our 24-bit audio without loss
        sf.write(str(inp), data, rate, subtype="FLOAT")
        cmd = [str(binary), "-D", "-a", f"{max(0.0, atten_db):.1f}", "-o", str(outdir), str(inp)]
        try:
            run = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired as e:
            raise DenoiseError("noise reduction timed out") from e
        out = outdir / "in.wav"
        if run.returncode != 0 or not out.exists():
            tail = (run.stderr or run.stdout or "").strip().splitlines()[-1:] or ["no output"]
            raise DenoiseError(f"deep-filter failed: {tail[0]}")
        clean, crate = sf.read(str(out), dtype="float32", always_2d=True)
    if crate != rate:
        raise DenoiseError("unexpected sample rate from deep-filter")
    if len(clean) < len(data):                                   # delay compensation trims the tail slightly
        clean = np.pad(clean, ((0, len(data) - len(clean)), (0, 0)))
    clean = clean[: len(data)]
    sf.write(str(dst), clean, rate, subtype="PCM_24")


def ensure_clean(project: Project, progress=None) -> Path:
    """Cleaned mic for this project, re-using the cached file when the take and strength are unchanged."""
    key = f"{project.mic_path.stat().st_mtime_ns}:{project.denoise_atten_db:.1f}"
    if project.clean_path.exists() and project.clean_key == key:
        return project.clean_path
    if progress:
        progress("Reducing noise (DeepFilterNet)")
    denoise(project.mic_path, project.clean_path, project.denoise_atten_db)
    project.clean_key = key
    return project.clean_path
