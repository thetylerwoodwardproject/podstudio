import time

import numpy as np
import pytest
import soundfile as sf

gi = pytest.importorskip("gi")
from gi.repository import GLib  # noqa: E402

from podstudio import audio  # noqa: E402

SR = 48000


def wav(tmp_path, sec=3.0, name="a.wav", ch=1):
    t = np.arange(int(sec * SR)) / SR
    x = 0.5 * np.sin(2 * np.pi * 440 * t)
    sf.write(tmp_path / name, x if ch == 1 else np.stack([x] * ch, 1), SR, subtype="PCM_24")
    return tmp_path / name


def pump(seconds):
    end = time.time() + seconds
    ctx = GLib.MainContext.default()
    while time.time() < end:
        ctx.iteration(False)
        time.sleep(0.005)


def test_peaks_shape_and_values(tmp_path):
    p = audio.compute_peaks(wav(tmp_path, 4.0), bins=200)
    assert p.shape == (200, 2)
    assert p[:, 1].max() == pytest.approx(0.5, abs=0.01) and p[:, 0].min() == pytest.approx(-0.5, abs=0.01)
    assert np.all(p[:, 0] <= p[:, 1])


def test_peaks_show_silence_and_sound(tmp_path):
    x = np.concatenate([np.zeros(2 * SR), 0.8 * np.sin(2 * np.pi * 300 * np.arange(2 * SR) / SR)])
    sf.write(tmp_path / "gap.wav", x, SR, subtype="PCM_24")
    p = audio.compute_peaks(tmp_path / "gap.wav", bins=100)
    assert np.abs(p[:45]).max() < 0.01 and np.abs(p[55:]).max() > 0.7


def test_peaks_cope_with_stereo_and_tiny_files(tmp_path):
    assert audio.compute_peaks(wav(tmp_path, 1.0, "s.wav", ch=2), bins=50).shape == (50, 2)
    sf.write(tmp_path / "tiny.wav", np.zeros(10), SR, subtype="PCM_24")
    assert audio.compute_peaks(tmp_path / "tiny.wav", bins=50).shape == (50, 2)


def test_player_loads_seeks_and_plays(tmp_path):
    f = wav(tmp_path, 3.0)
    done = []
    pl = audio.Player(on_eos=lambda: done.append(1), sink="fakesink sync=true")      # real-time clock, no sound card
    assert pl.load(f)
    assert pl.duration() == pytest.approx(3.0, abs=0.05)
    pl.seek(1.5); pump(0.2)
    assert pl.position() == pytest.approx(1.5, abs=0.1) and not pl.playing
    pl.play(); pump(0.6)
    assert pl.playing and 1.9 < pl.position() < 2.4                                   # advanced about 0.6 s
    pl.pause(); p = pl.position(); pump(0.3)
    assert pl.position() == pytest.approx(p, abs=0.02)                                # paused means stopped
    pl.seek(2.9); pl.play(); pump(0.6)
    assert done and not pl.playing and pl.position() < 0.2                            # EOS rewinds to the start
    pl.stop()


def test_player_keeps_position_when_switching_files(tmp_path):
    a, b = wav(tmp_path, 3.0, "a.wav"), wav(tmp_path, 3.0, "b.wav")
    pl = audio.Player(sink="fakesink sync=true")
    pl.load(a); pl.seek(1.2); pump(0.2)
    pl.load(b, position=pl.position()); pump(0.2)
    assert pl.position() == pytest.approx(1.2, abs=0.1)
    pl.stop()


def test_player_reports_unplayable_files(tmp_path):
    bad = tmp_path / "bad.wav"
    bad.write_bytes(b"not audio at all")
    assert audio.Player(sink="fakesink").load(bad) is False
