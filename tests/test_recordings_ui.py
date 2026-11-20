import time

import numpy as np
import pytest
import soundfile as sf

gi = pytest.importorskip("gi")
gi.require_version("Gtk", "4.0")
from gi.repository import GLib, Gtk  # noqa: E402

if not Gtk.init_check():
    pytest.skip("needs a display", allow_module_level=True)

from podstudio import recordings_ui  # noqa: E402
from podstudio.project import SAMPLE_RATE as SR, Event, Project  # noqa: E402


class FakeWin:
    def __init__(self, project):
        self.project, self.toasts, self.activated, self.chapter_hooks = project, [], [], 0
    def toast(self, m): self.toasts.append(m)
    def activate_project(self, path): self.activated.append(path)
    def on_chapters_changed(self): self.chapter_hooks += 1


def pump(seconds=0.4, cond=None):
    end, ctx = time.time() + seconds, GLib.MainContext.default()
    while time.time() < end and not (cond and cond()):
        ctx.iteration(False)
        time.sleep(0.005)


@pytest.fixture
def page(tmp_path, monkeypatch):
    monkeypatch.setattr(recordings_ui, "DEFAULT_ROOT", tmp_path)
    p = Project.create("Listening test", parent=tmp_path)
    t = np.arange(20 * SR) / SR
    for path in (p.mic_path, p.master_path):
        sf.write(path, 0.2 * np.sin(2 * np.pi * 200 * t), SR, subtype="PCM_24")
    p.mic_duration = 20.0
    p.events = [Event(t=3.0, pad=0, clip="a.wav"), Event(t=12.0, pad=1, clip="b.wav")]
    p.save()
    w = FakeWin(p)
    pg = recordings_ui.RecordingsPage(w, sink="fakesink sync=true")
    pump(0.3)
    return pg, w, p


def test_the_active_session_is_selected_and_loaded(page):
    pg, w, p = page
    assert pg.sel_path == p.root and pg.player.path == p.master_path
    assert pg.player.duration() == pytest.approx(20.0, abs=0.1)
    assert pg._tracks["master"].get_sensitive() and pg._tracks["mic"].get_sensitive()
    assert not pg._tracks["mp3"].get_sensitive()                 # nothing exported yet


def test_refreshing_does_not_reset_playback(page):
    """Regression: a refresh (after every render, export and tab switch) used to snap playback back to 0:00."""
    pg, w, p = page
    pg._seek(7.5)
    pump(0.3)
    assert pg.player.position() == pytest.approx(7.5, abs=0.1)
    for _ in range(3):
        pg.refresh()
        pump(0.3)                                                # GTK's deferred selection signal arrives here
    assert pg.player.position() == pytest.approx(7.5, abs=0.15)


def test_switching_stems_keeps_the_moment(page):
    pg, w, p = page
    pg._seek(9.0); pump(0.3)
    pg._tracks["mic"].set_active(True)
    pump(0.4)
    assert pg.player.path == p.mic_path and pg.player.position() == pytest.approx(9.0, abs=0.2)


def test_play_pause_and_keys(page):
    pg, w, p = page
    assert pg.on_key("space") and pg.player.playing
    pump(0.4)
    assert pg.player.position() > 0.2
    assert pg.on_key("space") and not pg.player.playing
    pos = pg.player.position()
    assert pg.on_key("Right"); pump(0.3)
    assert pg.player.position() == pytest.approx(pos + 5.0, abs=0.3)
    assert not pg.on_key("x")


def test_pause_is_what_recording_calls(page):
    pg, w, p = page
    pg.toggle(); pump(0.2)
    pg.pause()
    assert not pg.player.playing


def test_hit_markers_use_the_pad_colours_and_jump_buttons_find_them(page):
    pg, w, p = page
    assert [round(t) for t, _ in pg._hit_marks()] == [3, 12]
    pg._seek(0.0); pump(0.2)
    pg._jump_hit(+1); pump(0.3)
    assert pg.player.position() == pytest.approx(3.0, abs=0.2)
    pg._jump_hit(+1); pump(0.3)
    assert pg.player.position() == pytest.approx(12.0, abs=0.2)


def test_chapters_are_added_at_the_playhead_sorted_and_saved(page):
    pg, w, p = page
    pg._seek(14.0); pump(0.3); pg.add_chapter_here()
    pg._seek(5.0); pump(0.3); pg.add_chapter_here()
    assert [round(c["t"]) for c in p.chapters] == [5, 14]                 # kept in time order
    assert pg.wave.chapter_times == [5.0, 14.0] or [round(t) for t in pg.wave.chapter_times] == [5, 14]
    assert w.chapter_hooks >= 2
    assert [round(c["t"]) for c in Project.load(p.root).chapters] == [5, 14]   # persisted
    p.chapters.pop(0); pg._chapters_changed()
    assert len(p.chapters) == 1


def test_open_session_hands_off_to_the_window(page):
    pg, w, p = page
    pg._open_selected()
    assert w.activated == [p.root]


def test_a_late_selection_signal_for_the_open_session_is_ignored(page):
    """The real bug: in a shown window GTK delivers row-selected after a refresh, past the 'rebuilding' flag. The handler
    then reloaded the file and snapped playback to 0:00. Deliver that late signal directly and check nothing happens."""
    pg, w, p = page
    pg._seek(7.5); pump(0.3)
    assert pg.player.position() == pytest.approx(7.5, abs=0.1)
    row = pg.listbox.get_first_child()
    assert row.session["path"] == pg.sel_path
    pg._rebuilding = False
    pg._on_row_selected(pg.listbox, row)                    # the late, duplicate selection
    pump(0.4)
    assert pg.player.position() == pytest.approx(7.5, abs=0.15)
