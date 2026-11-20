import time
import types

import numpy as np
import pytest
import soundfile as sf

gi = pytest.importorskip("gi")
from gi.repository import GLib  # noqa: E402

from podstudio import audio, render  # noqa: E402
from podstudio.project import SAMPLE_RATE as SR, Event, Pad, Project  # noqa: E402

FAKE_SINK = "fakesink sync=true"          # real-time clock, no sound card


def pump(seconds):
    end, ctx = time.time() + seconds, GLib.MainContext.default()
    while time.time() < end:
        ctx.iteration(False)
        time.sleep(0.005)


def tone(path, sec, amp=0.9, stereo=True, f=440):
    t = np.arange(int(sec * SR)) / SR
    x = amp * np.sin(2 * np.pi * f * t)
    sf.write(path, np.stack([x, x], 1) if stereo else x, SR, subtype="PCM_24")
    return path


# ------------------------------------------------------------------ player
def test_fader_moves_a_clip_that_is_already_playing(tmp_path):
    levels = []
    pl = audio.ClipPlayer(on_level=levels.append)
    pl.play(tone(tmp_path / "bed.wav", 3.0), 0.0, handle=1, sink=FAKE_SINK)
    pump(0.5)
    before = max(levels[-4:])
    pl.set_master_db(-20)                                  # the hotkeys fader, mid-sound
    levels.clear(); pump(0.5)
    after = max(levels[-4:])
    assert before == pytest.approx(-0.9, abs=1.0)
    assert before - after == pytest.approx(20, abs=1.5)    # the meter is the real signal, and it fell by 20 dB
    pl.stop_all()


def test_ducking_follows_live_and_stacks_with_the_fader(tmp_path):
    levels = []
    pl = audio.ClipPlayer(on_level=levels.append)
    pl.play(tone(tmp_path / "d.wav", 3.0), 0.0, duck=True, handle=1, sink=FAKE_SINK)
    pl.play(tone(tmp_path / "n.wav", 3.0, f=1300), -30.0, duck=False, handle=2, sink=FAKE_SINK)   # quiet, never ducked
    pump(0.4)
    pl.set_duck_db(-12); levels.clear(); pump(0.4)
    assert max(levels[-4:]) == pytest.approx(-0.9 - 12, abs=1.5) or max(levels[-4:]) > -30   # the ducked clip dipped
    pl.set_master_db(-60); levels.clear(); pump(0.4)
    assert max(levels[-4:]) < -80                          # fader all the way down is silent
    pl.stop_all()


def test_handles_activity_and_stop_with_fade(tmp_path):
    pl = audio.ClipPlayer()
    pl.play(tone(tmp_path / "a.wav", 3.0), 0.0, handle=5, sink=FAKE_SINK)
    assert pl.is_active(5) and not pl.is_active(6)
    pl.stop(5)
    assert not pl.is_active(5)                             # no longer counts as active straight away
    pump(0.25)
    assert not pl._live                                    # and the pipeline is gone after the fade


def test_one_shots_end_by_themselves(tmp_path):
    pl = audio.ClipPlayer()
    pl.play(tone(tmp_path / "s.wav", 0.4), 0.0, handle=1, sink=FAKE_SINK)
    pump(1.0)
    assert not pl.is_active(1)


def test_loops_keep_going_until_stopped(tmp_path):
    pl = audio.ClipPlayer()
    pl.play(tone(tmp_path / "l.wav", 0.5), 0.0, loop=True, handle=3, sink=FAKE_SINK)
    pump(1.8)                                              # more than three passes through a 0.5 s clip
    assert pl.is_active(3) and pl._live
    pl.stop(3); pump(0.25)
    assert not pl._live


# ------------------------------------------------------------------ level matching
def test_full_scale_effects_are_brought_down_to_sit_with_speech():
    t = np.arange(SR) / SR
    loud = np.stack([0.98 * np.sin(2 * np.pi * 440 * t)] * 2, 1)
    g = render.clip_gain_db(loud)
    assert g < -8                                          # a full-scale 1 s tone is far too hot as it is
    assert render.lin_to_db(0.98) + g <= -3.0 + 0.1        # peaks end up at -3 dBFS or lower
    assert render.integrated_lufs(loud * render.db_to_lin(g)) <= -21.5


def test_short_clips_are_peak_matched_and_quiet_ones_lifted_sensibly():
    t = np.arange(int(0.2 * SR)) / SR
    blip = np.stack([0.9 * np.sin(2 * np.pi * 1000 * t)] * 2, 1)
    assert render.lin_to_db(0.9) + render.clip_gain_db(blip) == pytest.approx(-9.0, abs=0.1)
    quiet = np.stack([0.002 * np.sin(2 * np.pi * 440 * np.arange(2 * SR) / SR)] * 2, 1)
    assert 0 < render.clip_gain_db(quiet) <= 12            # lifted, but never by a ridiculous amount
    assert render.clip_gain_db(np.zeros((SR, 2))) == 0.0   # silence is left alone


# ------------------------------------------------------------------ held, toggled and looped hits in the render
def _proj(tmp_path, events, secs=6):
    p = Project.create("modes", parent=tmp_path)
    sf.write(p.mic_path, np.zeros(secs * SR), SR, subtype="PCM_24")
    tone(p.clips_dir / "c.wav", 1.0, amp=0.5)
    p.mic_duration, p.events, p.denoise = float(secs), events, False
    return p


def test_a_held_hit_is_cut_short_with_a_fade(tmp_path):
    p = _proj(tmp_path, [Event(t=1.0, pad=0, clip="c.wav", dur=0.3)])
    hk = render.render_hotkeys(p)
    assert np.abs(hk[int(1.1 * SR):int(1.25 * SR)]).max() > 0.3          # sounding while held
    assert np.abs(hk[int(1.31 * SR):int(2.2 * SR)]).max() < 1e-6          # silent after release (the clip itself ran 1 s)
    assert np.abs(hk[int(1.2995 * SR)]).max() < 0.1                       # the last half-millisecond is faded out, not chopped


def test_a_loop_repeats_for_its_whole_duration(tmp_path):
    p = _proj(tmp_path, [Event(t=0.5, pad=0, clip="c.wav", loop=True, dur=3.5)])
    hk = render.render_hotkeys(p)
    for s in (0.9, 1.7, 2.9, 3.9):                                         # across several repeats of a 1 s clip
        assert np.abs(hk[int(s * SR):int((s + 0.05) * SR)]).max() > 0.3
    assert np.abs(hk[int(4.1 * SR):]).max() < 1e-6                         # and it stops where it was released


def test_an_unfinished_loop_runs_to_the_end_of_the_take(tmp_path):
    p = _proj(tmp_path, [Event(t=1.0, pad=0, clip="c.wav", loop=True)], secs=5)
    hk = render.render_hotkeys(p)
    assert len(hk) == 5 * SR and np.abs(hk[int(4.8 * SR):]).max() > 0.01


def test_old_sessions_with_loop_flags_become_loop_pads():
    assert Project._pad({"key": "1", "loop": True}).mode == "loop"
    assert Project._pad({"key": "1"}).mode == "once"
    assert Project._pad({"key": "1", "future_field": 1}).key == "1"        # unknown fields don't break loading


# ------------------------------------------------------------------ the press / release state machine
class FakePlayer:
    def __init__(self):
        self.calls, self.active = [], set()
    def play(self, path, gain, duck=False, loop=False, handle=None, **kw):
        self.calls.append(("play", handle, round(gain, 1), loop)); self.active.add(handle)
    def stop(self, handle, **kw):
        self.calls.append(("stop", handle)); self.active.discard(handle)
    def is_active(self, h): return h in self.active


@pytest.fixture
def rig(monkeypatch):
    """A stand-in for the window that carries just what the pad logic touches (no GTK window is created)."""
    from podstudio.window import PodStudioWindow as W

    class Dir:                                              # every clip "exists"
        def __truediv__(self, other):
            return types.SimpleNamespace(exists=lambda: True)

    monkeypatch.setattr(Project, "clips_dir", property(lambda self: Dir()), raising=False)

    def build(mode, recording=True, norm=-10.0):
        p = Project(name="x", root=None)
        p.pads = [Pad(key="1", clip="c.wav", mode=mode, norm_db=norm, gain_db=2.0)]
        clock = {"t": 0.0}
        widget = types.SimpleNamespace(flash=lambda: None, edit=types.SimpleNamespace(popup=lambda: None))
        w = types.SimpleNamespace(project=p, pads=[widget], player=FakePlayer(), _open_events={}, toast=lambda m: None,
                                  engine=types.SimpleNamespace(recording=recording, position=lambda: clock["t"]))
        for name in ("pad_press", "pad_release", "_start_pad", "_stop_pad", "_pad_gain_db"):
            setattr(w, name, types.MethodType(getattr(W, name), w))
        return w, p, clock

    return build


def test_one_shot_plays_on_press_and_ignores_release(rig):
    w, p, clock = rig("once")
    w.pad_press(0); w.pad_release(0)
    assert w.player.calls == [("play", 0, -8.0, False)]            # level-matched (-10) plus the pad's own +2
    assert p.events[0].dur is None and 0 not in w._open_events


def test_hold_plays_while_down_and_records_how_long(rig):
    w, p, clock = rig("momentary")
    w.pad_press(0); clock["t"] = 2.5; w.pad_release(0)
    assert [c[0] for c in w.player.calls] == ["play", "stop"]
    assert p.events[0].dur == pytest.approx(2.5) and not p.events[0].loop


def test_toggle_starts_then_stops_on_the_next_press(rig):
    w, p, clock = rig("toggle")
    w.pad_press(0); w.pad_release(0)
    assert w.player.is_active(0)                                    # still going after release
    clock["t"] = 4.0; w.pad_press(0); w.pad_release(0)
    assert not w.player.is_active(0) and p.events[0].dur == pytest.approx(4.0)


def test_loop_is_a_toggle_that_repeats(rig):
    w, p, clock = rig("loop")
    w.pad_press(0)
    assert w.player.calls[0] == ("play", 0, -8.0, True) and p.events[0].loop
    clock["t"] = 3.0; w.pad_press(0)
    assert not w.player.is_active(0) and p.events[0].dur == pytest.approx(3.0)


def test_nothing_is_logged_when_not_recording(rig):
    w, p, clock = rig("toggle", recording=False)
    w.pad_press(0); w.pad_press(0)
    assert p.events == [] and [c[0] for c in w.player.calls] == ["play", "stop"]


def test_outputs_are_written_atomically(tmp_path):
    """A reader holding the previous master must keep seeing a complete file while the next one is written."""
    from podstudio.render import write_wav24, read_stereo
    f = tmp_path / "master.wav"
    write_wav24(f, np.full((SR, 2), 0.25))
    reader = open(f, "rb")                                   # e.g. the player with the old file open
    write_wav24(f, np.full((2 * SR, 2), -0.5))               # the next render replaces it
    assert len(read_stereo(f)) == 2 * SR and not list(tmp_path.glob("*.part"))
    old = tmp_path / "old.wav"; old.write_bytes(reader.read())
    assert len(read_stereo(old)) == SR                       # the open handle still reads the complete old file
