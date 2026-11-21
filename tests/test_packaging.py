import os
import struct
import subprocess
import types
from pathlib import Path

import pytest

from podstudio import alsa_gain, audio, denoise, podmic, runtime


# ------------------------------------------------------------------ which package format is running
def test_each_format_is_recognised(monkeypatch, tmp_path):
    for k in ("FLATPAK_ID", "SNAP", "SNAP_NAME", "APPIMAGE", "APPDIR"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(runtime, "PACKAGE_ROOT", tmp_path)
    assert runtime.kind() == "source" and runtime.updates_enabled() and not runtime.sandboxed()
    monkeypatch.setattr(runtime, "PACKAGE_ROOT", Path("/usr/lib/podstudio"))
    assert runtime.kind() == "deb" and runtime.updates_enabled()
    monkeypatch.setenv("APPIMAGE", "/x/PodStudio.AppImage"); monkeypatch.setenv("APPDIR", "/tmp/.mount_x")
    assert runtime.kind() == "appimage" and runtime.updates_enabled()
    monkeypatch.setenv("SNAP", "/snap/podstudio/1"); monkeypatch.setenv("SNAP_NAME", "podstudio")
    assert runtime.kind() == "snap" and not runtime.updates_enabled() and runtime.sandboxed()
    monkeypatch.setenv("FLATPAK_ID", "io.github.thetylerwoodwardproject.PodStudio")
    assert runtime.kind() == "flatpak" and not runtime.updates_enabled()          # Flatpak wins: it is the strictest sandbox
    monkeypatch.setenv("SNAP_NAME", "someone-elses-snap")
    monkeypatch.delenv("FLATPAK_ID")
    assert runtime.kind() != "snap"                                                # another snap's variables don't count


def test_the_bundled_denoiser_is_found_next_to_the_app_in_any_layout(monkeypatch, tmp_path):
    root = tmp_path / "prefix" / "lib" / "podstudio"
    (root / "bin").mkdir(parents=True)
    exe = root / "bin" / "deep-filter"
    exe.write_text("#!/bin/sh\n"); exe.chmod(0o755)
    monkeypatch.setattr(runtime, "PACKAGE_ROOT", root)
    monkeypatch.delenv("PODSTUDIO_DEEPFILTER", raising=False)
    assert runtime.bundled("bin", "deep-filter") == exe and runtime.bundled("bin", "nope") is None
    assert denoise.find_binary() == exe


# ------------------------------------------------------------------ no host tools needed
def test_card_is_found_from_proc_without_amixer(tmp_path):
    (tmp_path / "card0").mkdir(); (tmp_path / "card4").mkdir()
    (tmp_path / "cards").write_text(" 0 [Generic ]: HDA-Intel - HD-Audio Generic\n                      x\n 4 [USB     ]: USB-Audio - PodMic\n")
    (tmp_path / "card0" / "usbid").write_text("0000:0000\n")
    (tmp_path / "card4" / "usbid").write_text("19F7:004A\n")
    assert alsa_gain.find_card(proc=str(tmp_path)) == 4
    assert alsa_gain.find_card(usbid=(0x1234, 1), proc=str(tmp_path)) is None
    assert alsa_gain.find_card(proc=str(tmp_path / "missing")) is None


def test_the_alsa_bindings_work_against_a_real_mixer_read_only():
    """Reads a gain from whichever sound card here has a capture control: proves the ctypes signatures are right."""
    try:
        alsa_gain._asound()
    except OSError:
        pytest.skip("libasound not available")
    found = []
    for card in range(0, 8):
        for control in ("Capture", "Mic", "Master", "PCM", "Headphone"):
            if alsa_gain.get_capture_db(card, control) is not None or alsa_gain.capture_range_db(card, control) is not None:
                found.append((card, control, alsa_gain.get_capture_db(card, control), alsa_gain.capture_range_db(card, control)))
    if not found:
        pytest.skip("no readable capture mixer control on this machine")
    card, control, db, rng = found[0]
    assert db is None or -200 < db < 200
    assert rng is None or rng[0] <= rng[1]
    assert alsa_gain.get_capture_db(99, "Mic") is None and alsa_gain.set_capture_db(99, 30.0) is False   # no such card


def test_gain_uses_alsa_first_and_amixer_only_as_a_fallback(monkeypatch):
    calls = []
    monkeypatch.setattr(podmic, "find_alsa_card", lambda: "4")
    monkeypatch.setattr(alsa_gain, "get_capture_db", lambda card, control="Mic": 57.5)
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: calls.append(a) or subprocess.CompletedProcess(a, 0, stdout="[63.00dB]"))
    assert podmic.get_gain_db() == 57.5 and not calls                                  # amixer never started
    monkeypatch.setattr(alsa_gain, "get_capture_db", lambda card, control="Mic": None)
    assert podmic.get_gain_db() == 63.0 and calls                                      # fell back
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: (_ for _ in ()).throw(FileNotFoundError("amixer")))
    assert podmic.get_gain_db() is None                                                # no amixer, no ALSA: just "unknown"


def test_set_gain_is_clamped_to_what_the_mic_supports(monkeypatch):
    seen = []
    monkeypatch.setattr(podmic, "find_alsa_card", lambda: "4")
    monkeypatch.setattr(alsa_gain, "set_capture_db", lambda card, db, control="Mic": seen.append(db) or True)
    assert podmic.set_gain_db(100) and podmic.set_gain_db(-5) and podmic.set_gain_db(50)
    assert seen == [63.0, 22.0, 50]


def test_the_mic_is_found_without_pactl(monkeypatch):
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: (_ for _ in ()).throw(FileNotFoundError("pactl")))
    monkeypatch.setattr(audio, "_gst_source_name", lambda match: "alsa_input.usb-fake" if match("", "x podmic usb") else None)
    assert audio.find_podmic_source() == "alsa_input.usb-fake"
    assert audio._is_podmic("", "foo vendor 0x19f7 product 0x004a") and not audio._is_podmic("Built-in", "intel hda")


def test_gstreamer_device_listing_works_here():
    """Real run: ask GStreamer for any audio input. Proves the sandbox-friendly path runs; it needs no host tools."""
    name = audio._gst_source_name(lambda n, t: True)
    if name is None:
        pytest.skip("no audio inputs on this machine")
    assert isinstance(name, str) and not name.endswith(".monitor")


def test_hidraw_is_found_by_asking_the_device_when_sysfs_is_hidden(monkeypatch):
    import fcntl
    monkeypatch.setattr(podmic.glob, "glob", lambda pat: ["/dev/hidraw3", "/dev/hidraw5"] if pat == "/dev/hidraw*" else [])
    monkeypatch.setattr(podmic.os, "open", lambda path, flags: {"/dev/hidraw3": 30, "/dev/hidraw5": 50}[path])
    monkeypatch.setattr(podmic.os, "close", lambda fd: None)
    ids = {30: (0x046D, 0xC52B), 50: (0x19F7, 0x004A)}
    monkeypatch.setattr(fcntl, "ioctl", lambda fd, req, buf: struct.pack("Ihh", 3, *[v if v < 0x8000 else v - 0x10000 for v in ids[fd]]))
    assert podmic.find_hidraw() == "/dev/hidraw5"
    ids[50] = (0x1234, 0x5678)
    assert podmic.find_hidraw() is None


def test_library_lookup_works_without_ldconfig_or_gcc(monkeypatch, tmp_path):
    """In a bundle the normal lookup finds nothing; the shim must find libraries on LD_LIBRARY_PATH instead."""
    import ctypes.util
    import importlib
    (tmp_path / "libfoobar.so.1").write_bytes(b"x")
    monkeypatch.setattr(ctypes.util, "find_library", lambda name: None)     # what a bundle without ldconfig gives
    monkeypatch.setenv("LD_LIBRARY_PATH", f"{tmp_path}:/nowhere")
    import podstudio
    importlib.reload(podstudio)                                              # installs the shim over the patched lookup
    assert ctypes.util.find_library("foobar") == str(tmp_path / "libfoobar.so.1")
    assert ctypes.util.find_library("definitely-not-a-library") is None


def test_mp3_is_still_readable_when_libsndfile_cannot_decode_it(tmp_path, monkeypatch):
    """The Flatpak runtime's libsndfile has no MP3 support. Reading and waveforms must fall back to GStreamer."""
    import numpy as np
    import soundfile as sf
    sr = 48000
    t = np.arange(2 * sr) / sr
    wav, mp3 = tmp_path / "t.wav", tmp_path / "t.mp3"
    sf.write(wav, 0.4 * np.sin(2 * np.pi * 440 * t), sr, subtype="PCM_24")
    audio.encode_mp3(wav, mp3)
    real_read, real_info = sf.read, sf.info
    refuse = lambda f, *a, **k: (_ for _ in ()).throw(sf.LibsndfileError(1, "unimplemented format")) if str(f).endswith(".mp3") else None
    monkeypatch.setattr(sf, "read", lambda f, *a, **k: refuse(f) or real_read(f, *a, **k))
    monkeypatch.setattr(sf, "info", lambda f, *a, **k: refuse(f) or real_info(f, *a, **k))
    data, rate = audio.read_audio(mp3)
    assert rate == sr and abs(len(data) / rate - 2.0) < 0.15 and data.shape[1] == 2 and abs(data).max() > 0.3
    peaks = audio.compute_peaks(mp3, bins=100)
    assert peaks.shape == (100, 2) and peaks[:, 1].max() > 0.3 and peaks[:, 0].min() < -0.3
