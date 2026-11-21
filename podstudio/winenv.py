"""Windows only: point GTK, GStreamer and friends at the copies bundled next to PodStudio.exe.

The launcher sets one variable, PODSTUDIO_HOME (the install folder), and Python calls `prepare()` before anything
imports GTK. Keeping this in Python rather than in the launcher means it can be read, tested and fixed without a
C compiler. Nothing here runs on Linux.
"""
from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from pathlib import Path

LOG_NAME = "podstudio.log"
LOG_LIMIT = 1_000_000                                   # bytes; the log starts over when it grows past this


def environment(home: Path, cache: Path) -> dict[str, str]:
    """The variables a bundled GTK + GStreamer stack needs, given the install folder and a writable cache folder."""
    env = {
        "GI_TYPELIB_PATH": str(home / "lib" / "girepository-1.0"),
        "GST_PLUGIN_PATH": str(home / "lib" / "gstreamer-1.0"),
        "GST_PLUGIN_SYSTEM_PATH": str(home / "lib" / "gstreamer-1.0"),     # never pick up some other GStreamer
        "GST_REGISTRY_1_0": str(cache / "gst-registry.bin"),              # the install folder may be read-only
        "GST_REGISTRY_FORK": "no",
        "XDG_DATA_DIRS": str(home / "share"),
        "GSETTINGS_SCHEMA_DIR": str(home / "share" / "glib-2.0" / "schemas"),
        "GDK_PIXBUF_MODULEDIR": str(home / "lib" / "gdk-pixbuf-2.0" / "2.10.0" / "loaders"),
        "PYTHONIOENCODING": "utf-8",
    }
    scanner = home / "libexec" / "gstreamer-1.0" / "gst-plugin-scanner.exe"
    if scanner.exists():
        env["GST_PLUGIN_SCANNER"] = str(scanner)
    certs = home / "ssl" / "cacert.pem"
    if certs.exists():                                   # Python's ssl (GitHub, Buzzsprout) needs a list of trusted CAs
        env["SSL_CERT_FILE"] = str(certs)
    return env


def _loaders_cache(home: Path, cache: Path) -> str | None:
    """gdk-pixbuf's list of image loaders records absolute paths, so it has to be made on the machine it runs on."""
    query = home / "bin" / "gdk-pixbuf-query-loaders.exe"
    if not query.exists():
        return None
    key = hashlib.sha1(str(home).lower().encode()).hexdigest()[:10]
    out = cache / f"loaders-{key}.cache"
    if not out.exists():
        env = dict(os.environ, GDK_PIXBUF_MODULEDIR=str(home / "lib" / "gdk-pixbuf-2.0" / "2.10.0" / "loaders"))
        try:
            run = subprocess.run([str(query)], capture_output=True, text=True, timeout=60, env=env,
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if run.returncode == 0 and run.stdout.strip():
                out.write_text(run.stdout, encoding="utf-8")
        except (OSError, subprocess.SubprocessError):
            return None
    return str(out) if out.exists() else None


def _log_to_file(cache: Path) -> None:
    """There is no console, so keep what Python and GLib print in a log file a person can attach to a bug report."""
    log = cache / LOG_NAME
    try:
        if log.exists() and log.stat().st_size > LOG_LIMIT:
            log.replace(cache / (LOG_NAME + ".old"))
        f = open(log, "a", encoding="utf-8", buffering=1)
    except OSError:
        return
    for fd in (1, 2):                                     # C-level output too (GLib warnings go straight to fd 2)
        try:
            os.dup2(f.fileno(), fd)
        except OSError:
            pass
    if sys.stdout is None:
        sys.stdout = f
    if sys.stderr is None:
        sys.stderr = f


def prepare() -> None:
    """Called once, first thing, when running from the Windows build. Safe to call again."""
    home_s = os.environ.get("PODSTUDIO_HOME")
    if sys.platform != "win32" or not home_s:
        return
    home = Path(home_s)
    cache = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "PodStudio"
    try:
        cache.mkdir(parents=True, exist_ok=True)
    except OSError:
        cache = Path(os.environ.get("TEMP", "."))
    if sys.stderr is None or sys.stdout is None:
        _log_to_file(cache)
    for k, v in environment(home, cache).items():
        os.environ.setdefault(k, v)
    cache_file = _loaders_cache(home, cache)
    if cache_file:
        os.environ.setdefault("GDK_PIXBUF_MODULE_FILE", cache_file)
    bin_dir = str(home / "bin")
    if bin_dir.lower() not in os.environ.get("PATH", "").lower():
        os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")
    try:
        os.add_dll_directory(bin_dir)                      # ctypes and cffi look DLLs up through this on Python 3.8+
    except (AttributeError, OSError):
        pass
