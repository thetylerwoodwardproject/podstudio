import math
import pytest

gi = pytest.importorskip("gi")
gi.require_version("Gst", "1.0")
from gi.repository import Gst, GLib
from podstudio import audio

Gst.init(None)


def _have(name):
    return Gst.ElementFactory.find(name) is not None


def test_lufs_from_ms():
    assert audio.lufs_from_ms(0.0) == -90.0
    assert audio.lufs_from_ms(1.0) == pytest.approx(-0.691, abs=1e-6)


@pytest.mark.skipif(not _have("audioiirfilter"), reason="audioiirfilter missing")
def test_k_weighted_sine_calibration():
    # full-scale 997 Hz sine is -3.01 LUFS per BS.1770 (mono)
    pipe = Gst.parse_launch("audiotestsrc wave=sine freq=997 volume=1.0 num-buffers=100 samplesperbuffer=4800 ! "
                            "audio/x-raw,rate=48000,channels=1 ! " + audio.K_BRANCH.format(p="kf"))
    assert audio.set_k_filters(pipe, "kf")
    got = []
    bus = pipe.get_bus()
    pipe.set_state(Gst.State.PLAYING)
    while True:
        m = bus.timed_pop_filtered(5 * Gst.SECOND, Gst.MessageType.ELEMENT | Gst.MessageType.EOS | Gst.MessageType.ERROR)
        if m is None or m.type != Gst.MessageType.ELEMENT:
            break
        ms = audio.k_mean_square(m.get_structure())
        if ms is not None:
            got.append(ms)
    pipe.set_state(Gst.State.NULL)
    assert len(got) > 5
    assert audio.lufs_from_ms(sum(got[3:]) / len(got[3:])) == pytest.approx(-3.01, abs=0.1)
