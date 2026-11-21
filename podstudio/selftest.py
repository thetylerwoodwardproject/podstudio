"""`podstudio --self-test`: checks that this install has everything it needs, without opening a window.

Used to verify each package format (deb, Flatpak, AppImage), and handy in a bug report.
Exit status 0 means every required check passed. The microphone is reported but never required.
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path


def run(out=print) -> int:
    from . import __version__, runtime
    results: list[tuple[str, str, str]] = []             # (PASS | FAIL | INFO, check, detail)

    def check(name, fn):
        try:
            detail = fn()
            results.append(("PASS", name, detail or ""))
        except Exception as e:
            results.append(("FAIL", name, f"{type(e).__name__}: {e}"))

    def info(name, text):
        results.append(("INFO", name, text))

    info("PodStudio", f"v{__version__}, running as {runtime.describe()}")

    def libs():
        import numpy, scipy, soundfile
        return f"numpy {numpy.__version__}, scipy {scipy.__version__}, soundfile {soundfile.__version__} (libsndfile {soundfile.__libsndfile_version__})"
    check("Python libraries", libs)

    def gi_libs():
        import gi
        gi.require_version("Gtk", "4.0"); gi.require_version("Adw", "1"); gi.require_version("Gst", "1.0")
        gi.require_version("Secret", "1"); gi.require_version("GdkPixbuf", "2.0")
        from gi.repository import Adw, Gst, Gtk
        if (Adw.get_major_version(), Adw.get_minor_version()) < (1, 5):
            raise RuntimeError(f"libadwaita {Adw.get_major_version()}.{Adw.get_minor_version()} is older than 1.5")
        Gst.init(None)
        return f"GTK {Gtk.get_major_version()}.{Gtk.get_minor_version()}, libadwaita {Adw.get_major_version()}.{Adw.get_minor_version()}, GStreamer {Gst.version_string().split()[-1]}"
    check("GTK, libadwaita and GStreamer", gi_libs)

    def elements():
        import gi
        gi.require_version("Gst", "1.0")
        from gi.repository import Gst
        Gst.init(None)
        need = ["pulsesrc", "level", "volume", "tee", "queue", "audioconvert", "audioresample", "wavenc", "filesink",
                "filesrc", "decodebin", "playbin", "lamemp3enc", "id3v2mux", "autoaudiosink", "fakesink"]
        missing = [e for e in need if Gst.ElementFactory.find(e) is None]
        if missing:
            raise RuntimeError("missing GStreamer elements: " + ", ".join(missing))
        return f"all {len(need)} needed elements present"
    check("GStreamer elements", elements)

    def mp3():
        import numpy as np
        import soundfile as sf
        from . import audio
        with tempfile.TemporaryDirectory() as td:
            wav, mp3p = Path(td) / "t.wav", Path(td) / "t.mp3"
            t = np.arange(48000) / 48000
            sf.write(wav, 0.3 * np.sin(2 * np.pi * 440 * t), 48000, subtype="PCM_24")
            audio.encode_mp3(wav, mp3p, title="self-test")
            data, sr = audio.read_audio(mp3p)               # the same route the app uses to verify an export
            if not 0.9 < len(data) / sr < 1.2:
                raise RuntimeError(f"MP3 came back {len(data) / sr:.2f} s long")
        return "encoded and decoded a 1 s tone"
    check("MP3 export", mp3)

    def loud():
        import numpy as np
        from . import loudness
        t = np.arange(10 * 48000) / 48000
        v = loudness.integrated_loudness(np.stack([np.sin(2 * np.pi * 997 * t), np.zeros_like(t)], 1))
        if abs(v - (-3.01)) > 0.05:
            raise RuntimeError(f"reads {v:.2f} LUFS, expected -3.01")
        return "BS.1770 calibration point reads -3.01 LUFS"
    check("Loudness meter", loud)

    def dfn():
        import subprocess
        from . import denoise
        b = denoise.find_binary()
        if b is None:
            raise RuntimeError("deep-filter not found")
        r = subprocess.run([str(b), "--version"], capture_output=True, text=True, timeout=20)
        if r.returncode != 0:
            raise RuntimeError(f"deep-filter exited {r.returncode}")
        return f"{b} ({r.stdout.strip() or 'runs'})"
    check("DeepFilterNet", dfn)

    def project_io():
        from .project import Project
        with tempfile.TemporaryDirectory() as td:
            p = Project.create("self test", parent=Path(td)); p.save()
            Project.load(p.root)
        return "created, saved and reloaded a session"
    check("Session files", project_io)

    # the microphone is informational: a build is fine without one plugged in
    try:
        from . import audio, podmic
        hid = podmic.find_hidraw()
        src = audio.find_podmic_source()
        card = podmic.find_alsa_card()
        info("PodMic USB", f"control channel {'found' if hid else 'not found'}, audio input {'found' if src else 'not found'}, "
                           f"gain control {'reachable' if podmic.get_gain_db(card) is not None else 'not reachable'}"
                           + ("" if hid or src else " (plug it in to test)"))
    except Exception as e:
        info("PodMic USB", f"could not be checked ({type(e).__name__})")

    failed = 0
    for status, name, detail in results:
        out(f"[{status}] {name}" + (f": {detail}" if detail else ""))
        failed += status == "FAIL"
    out("\nAll required checks passed." if not failed else f"\n{failed} required check(s) FAILED.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(run())
