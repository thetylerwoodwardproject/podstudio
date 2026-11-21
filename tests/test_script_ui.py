"""The Script tab: formatting, typing with a format on, saving with the session, import and export, auto-scroll."""
import time

import pytest

gi = pytest.importorskip("gi")
gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
from gi.repository import Gdk, GLib, Gtk  # noqa: E402

if not Gtk.init_check():
    pytest.skip("needs a display", allow_module_level=True)

from podstudio import scriptdoc as sd  # noqa: E402
from podstudio import script_ui  # noqa: E402
from podstudio.project import Project  # noqa: E402


class FakeWin(Gtk.Window):
    """Just enough of the main window for the Script page: a project, config, toasts and a title label."""

    def __init__(self, tmp):
        super().__init__()
        self.tmp = tmp
        self.cfg, self.toasts, self.saved_cfg, self.remembered = {}, [], 0, 0
        self.project = Project(name="", root=tmp)               # unsaved scratch project, like a fresh launch
        self.title_label = Gtk.Label()

    def toast(self, m): self.toasts.append(m)
    def save_cfg(self): self.saved_cfg += 1
    def _remember(self): self.remembered += 1
    def _materialize(self):
        if not self.project.created:
            self.project = Project.create("Session test", parent=self.tmp)


def pump(seconds=0.1):
    end, ctx = time.time() + seconds, GLib.MainContext.default()
    while time.time() < end:
        ctx.iteration(False)
        time.sleep(0.005)


@pytest.fixture
def page(tmp_path):
    w = FakeWin(tmp_path)
    return script_ui.ScriptPage(w), w


def select(pg, a, b):
    pg.buf.select_range(pg.buf.get_iter_at_offset(a), pg.buf.get_iter_at_offset(b))


def spans(pg, tag):
    return [s for s in pg.doc().spans if s[0] == tag]


def test_an_empty_page_shows_the_hint_and_no_stats(page):
    pg, w = page
    assert pg.hint.get_visible() and pg.stats.get_text() == ""
    pg.set_doc(sd.Doc("one two three four", []))
    assert not pg.hint.get_visible() and pg.stats.get_text().startswith("4 words")


def test_bold_on_a_selection_toggles_off_again_and_extends_a_partial_one(page):
    pg, _ = page
    pg.set_doc(sd.Doc("hello big world", []))
    select(pg, 6, 9)
    pg.toggle_inline("bold")
    assert spans(pg, "bold") == [("bold", 6, 9)]
    select(pg, 0, 15)                                   # partly bold: the first press makes it all bold
    pg.toggle_inline("bold")
    assert spans(pg, "bold") == [("bold", 0, 15)]
    pg.toggle_inline("bold")                            # all bold: the next press clears it
    assert spans(pg, "bold") == []


def test_toolbar_buttons_follow_the_selection(page):
    pg, _ = page
    pg.set_doc(sd.Doc("hello world", [("italic", 0, 5)]))
    select(pg, 1, 4)
    pump(0.05)
    assert pg.fmt["italic"].get_active() and not pg.fmt["bold"].get_active()
    select(pg, 6, 11)
    pump(0.05)
    assert not pg.fmt["italic"].get_active()


def test_a_second_highlight_replaces_the_first_and_none_clears(page):
    pg, _ = page
    pg.set_doc(sd.Doc("highlight me please", []))
    select(pg, 0, 9)
    pg.choose("hl-yellow")
    pg.choose("hl-pink")
    assert spans(pg, "hl-pink") == [("hl-pink", 0, 9)] and spans(pg, "hl-yellow") == []
    pg.choose("hl-pink")                                # choosing the same colour again removes it
    assert spans(pg, "hl-pink") == []
    pg.choose("fg-red")
    pg.choose("hl-green")                               # a text colour and a highlight can sit together
    assert spans(pg, "fg-red") and spans(pg, "hl-green")
    pg.clear_group(sd.COLORS)
    assert spans(pg, "fg-red") == [] and spans(pg, "hl-green")


def test_formatting_chosen_with_no_selection_applies_to_the_next_typing_only(page):
    pg, _ = page
    pg.set_doc(sd.Doc("start ", []))
    pg.buf.place_cursor(pg.buf.get_end_iter())
    pg.toggle_inline("bold")
    pg.buf.insert_at_cursor("LOUD")
    pg.toggle_inline("bold")                            # turn it off again before the next word
    pg.buf.insert_at_cursor(" quiet")
    assert spans(pg, "bold") == [("bold", 6, 10)]
    assert pg.doc().text == "start LOUD quiet"


def test_pending_format_is_dropped_if_the_cursor_moves_away(page):
    pg, _ = page
    pg.set_doc(sd.Doc("abc def", []))
    pg.buf.place_cursor(pg.buf.get_iter_at_offset(3))
    pg.toggle_inline("italic")
    pg.buf.place_cursor(pg.buf.get_iter_at_offset(7))
    pg.buf.insert_at_cursor("X")
    assert spans(pg, "italic") == []


def test_typing_after_bold_text_stays_bold_like_any_editor(page):
    pg, _ = page
    pg.set_doc(sd.Doc("bold", [("bold", 0, 4)]))
    pg.buf.place_cursor(pg.buf.get_end_iter())
    assert pg.fmt["bold"].get_active() is True or pg._caret_has("bold")
    pg.buf.insert_at_cursor("er")
    assert spans(pg, "bold") == [("bold", 0, 6)]


def test_size_applies_to_whole_lines_and_normal_removes_it(page):
    pg, _ = page
    pg.set_doc(sd.Doc("Title here\nbody text\nmore body", []))
    select(pg, 3, 5)                                    # a few letters inside the first line
    pg.set_size("h1")
    assert spans(pg, "h1") == [("h1", 0, 10)]
    pg.buf.place_cursor(pg.buf.get_iter_at_offset(14))  # no selection: the line the cursor is on
    pg.set_size("small")
    assert spans(pg, "small") == [("small", 11, 20)]
    pg.set_size("h2")                                   # a size replaces the previous size on that line
    assert spans(pg, "small") == [] and spans(pg, "h2") == [("h2", 11, 20)]
    pg.set_size("")
    assert spans(pg, "h2") == []


def test_clear_formatting_removes_everything_from_the_selection(page):
    pg, _ = page
    pg.set_doc(sd.Doc("all dressed up", [("bold", 0, 14), ("hl-blue", 0, 3), ("fg-red", 4, 10)]))
    select(pg, 0, 14)
    pg.clear_formatting()
    assert pg.doc().spans == []


def test_document_round_trips_through_the_buffer(page):
    pg, _ = page
    doc = sd.Doc("Intro\nSay hello—é \U0001F600 end", [("h1", 0, 5), ("bold", 10, 15), ("hl-green", 12, 20), ("italic", 6, 29)])
    pg.set_doc(doc)
    assert pg.doc().text == doc.text
    assert set(pg.doc().spans) == set(sd.clean_spans(doc.spans, len(doc.text)))


def test_nothing_is_created_for_an_empty_script_but_typing_makes_a_session(page, tmp_path):
    pg, w = page
    pg.flush()
    assert not w.project.created and not list(tmp_path.glob("*/script.json"))
    pg.buf.insert_at_cursor("First line of the show")
    pg.flush()
    assert w.project.created and (w.project.root / "script.json").exists()
    assert w.remembered == 1 and w.title_label.get_text() == "Session test"
    assert sd.load(w.project.root / "script.json").text == "First line of the show"


def test_autosave_happens_a_moment_after_typing(page):
    pg, w = page
    pg.buf.insert_at_cursor("typed words")
    assert not w.project.created                       # not yet: it waits for a pause in typing
    pump(1.6)
    assert (w.project.root / "script.json").exists()


def test_each_session_keeps_its_own_script(page, tmp_path):
    pg, w = page
    pg.buf.insert_at_cursor("script A")
    pg.flush()
    first = w.project
    w.project = Project.create("Other", parent=tmp_path)
    pg.reload()
    assert pg.doc().is_empty() and pg._root == w.project.root
    pg.buf.insert_at_cursor("script B")
    pg.flush()
    w.project = first
    pg.reload()
    assert pg.doc().text == "script A"
    assert sd.load(first.root / "script.json").text == "script A"


def test_a_new_take_starts_with_a_copy_of_the_script(page, tmp_path):
    pg, w = page
    pg.set_doc(sd.Doc("the plan", [("bold", 4, 8)]))
    pg.flush()
    old = w.project
    new = Project.create("Take two", parent=tmp_path)
    pg.adopt(new.root)
    assert sd.load(new.root / "script.json") == sd.Doc("the plan", [("bold", 4, 8)])
    pg.buf.insert_at_cursor("!")
    pg.flush()
    assert sd.load(old.root / "script.json").text == "the plan"      # the first session is left as it was


def test_import_into_an_empty_script_just_loads_it(page, tmp_path):
    pg, w = page
    f = tmp_path / "notes.md"
    f.write_text("# Plan\nSay **hello**")
    pg.import_path(f)
    assert pg.doc().text == "Plan\nSay hello" and spans(pg, "bold") == [("bold", 9, 14)]
    assert any("Imported 3 words" in t for t in w.toasts)
    assert w.project.created                                           # importing counts as writing a script


def test_import_over_existing_text_asks_and_both_answers_work(page, tmp_path, monkeypatch):
    pg, w = page
    pg.set_doc(sd.Doc("keep me", [("bold", 0, 4)]))
    f = tmp_path / "more.txt"
    f.write_text("added text")
    asked = []
    monkeypatch.setattr(pg, "_ask_replace", lambda path, doc: asked.append(path))
    pg.import_path(f)
    assert asked == [f] and pg.doc().text == "keep me"                # nothing changes until the user answers
    pg.import_path(f, "append")
    assert pg.doc().text == "keep me\n\nadded text" and spans(pg, "bold") == [("bold", 0, 4)]
    pg.import_path(f, "replace")
    assert pg.doc().text == "added text" and pg.doc().spans == []


def test_appended_formatting_lands_on_the_right_words(page, tmp_path):
    pg, _ = page
    pg.set_doc(sd.Doc("first", []))
    f = tmp_path / "b.md"
    f.write_text("**second**")
    pg.import_path(f, "append")
    bold = spans(pg, "bold")[0]
    assert pg.doc().text[bold[1]:bold[2]] == "second"


def test_bad_files_get_a_plain_message_and_change_nothing(page, tmp_path):
    pg, w = page
    pg.set_doc(sd.Doc("safe", []))
    (tmp_path / "x.docx").write_text("not a zip")
    pg.import_path(tmp_path / "x.docx")
    (tmp_path / "empty.txt").write_text("  \n")
    pg.import_path(tmp_path / "empty.txt")
    pg.import_path(tmp_path / "missing.txt")
    assert pg.doc().text == "safe"
    assert len(w.toasts) == 3 and any("Word" in t for t in w.toasts) and any("no text" in t for t in w.toasts)


def test_export_writes_markdown_or_plain_text(page, tmp_path):
    pg, w = page
    pg.set_doc(sd.Doc("Big\nsay this", [("h1", 0, 3), ("bold", 8, 12)]))
    pg.export_path(tmp_path / "out.md")
    assert (tmp_path / "out.md").read_text() == "# Big\nsay **this**\n"
    pg.export_path(tmp_path / "out.txt")
    assert (tmp_path / "out.txt").read_text() == "Big\nsay this\n"
    pg.export_path(tmp_path / "no" / "such" / "dir.md")
    assert "Couldn't export" in w.toasts[-1]


def test_copy_without_a_selection_copies_the_whole_script(page):
    pg, w = page
    pg.set_doc(sd.Doc("whole script", []))
    pg.copy()
    assert w.toasts[-1] == "Copied the whole script"
    pg.set_doc(sd.Doc("", []))
    n = len(w.toasts)
    pg.copy()
    assert len(w.toasts) == n                          # nothing to copy, nothing claimed


def _long(pg, w):
    """A script much taller than the window, in a real (shown) window so the scroller has real sizes."""
    pg.set_doc(sd.Doc("word " * 4000, []))
    w.set_default_size(900, 700)
    w.set_child(pg)
    w.present()
    pump(0.5)
    adj = pg.scroller.get_vadjustment()
    assert adj.get_upper() - adj.get_page_size() > 1500
    return adj


def test_auto_scroll_moves_the_text_and_stops_at_the_end(page):
    pg, w = page
    adj = _long(pg, w)
    pg.start()
    assert pg._playing and not pg.view.get_editable() and not pg.view.get_cursor_visible()
    pg.set_speed(5)
    before = adj.get_value()
    assert pg.advance(1.0) is True
    assert adj.get_value() - before == pytest.approx(script_ui.speed_px(5), abs=1.0)
    pg.set_speed(10)
    end = adj.get_upper() - adj.get_page_size()
    assert pg.advance(1000.0) is True                  # a huge step is clamped to the end, then the next tick stops
    assert adj.get_value() == pytest.approx(end, abs=1.0)
    assert pg.advance(0.1) is False
    assert not pg._playing and pg.view.get_editable() and w.toasts[-1] == "Reached the end of the script"


def test_the_slowest_speed_really_moves_even_though_each_frame_is_a_fraction_of_a_pixel(page):
    """Regression guard: the adjustment can snap to whole pixels, which would stall 0.2 px steps forever."""
    pg, w = page
    adj = _long(pg, w)
    pg.set_speed(1)
    pg.start()
    for _ in range(120):                                # two seconds of 60 fps frames
        assert pg.advance(1 / 60)
    assert adj.get_value() == pytest.approx(2 * script_ui.speed_px(1), abs=1.5)
    adj.set_value(400)                                  # the user scrolls by hand: carry on from there
    pg.advance(1 / 60)
    assert adj.get_value() == pytest.approx(400, abs=2)
    pg.advance(1.0)
    assert adj.get_value() == pytest.approx(400 + script_ui.speed_px(1), abs=2)


def test_pressing_enter_after_a_heading_starts_a_plain_line(page):
    pg, _ = page
    pg.set_doc(sd.Doc("Heading", [("h1", 0, 7), ("bold", 0, 7)]))
    pg.buf.place_cursor(pg.buf.get_end_iter())
    pg.buf.insert_at_cursor("\nnext line")
    assert spans(pg, "h1") == [("h1", 0, 7)]            # the new line is not a heading
    assert spans(pg, "bold") == [("bold", 0, 17)]       # but bold carries on, as it does in a word processor


def test_speed_steps_get_faster_and_stay_in_range():
    px = [script_ui.speed_px(n) for n in range(1, 11)]
    assert px == sorted(px) and px[0] == pytest.approx(14.0) and 150 < px[-1] < 300
    assert script_ui.speed_px(0) == px[0] and script_ui.speed_px(99) == px[-1]


def test_auto_scroll_refuses_an_empty_script(page):
    pg, w = page
    pg.start()
    assert not pg._playing and w.toasts[-1] == "Write or import a script first."


def test_keyboard_controls_while_scrolling(page):
    pg, w = page
    _long(pg, w)
    assert pg._on_key(None, Gdk.KEY_F8, 0, 0) is True and pg._playing
    pg.set_speed(4)
    assert pg._on_key(None, Gdk.KEY_Up, 0, 0) and pg.speed == 5
    assert pg._on_key(None, Gdk.KEY_Down, 0, 0) and pg.speed == 4
    pg.scroller.get_vadjustment().set_value(900)
    assert pg._on_key(None, Gdk.KEY_Home, 0, 0) and pg.scroller.get_vadjustment().get_value() == 0
    assert pg._on_key(None, Gdk.KEY_space, 0, 0) and not pg._playing
    assert pg._on_key(None, Gdk.KEY_space, 0, 0) is False          # a space is just a space when not scrolling


def test_scrolling_can_start_and_stop_with_the_recording(page):
    pg, w = page
    adj = _long(pg, w)
    adj.set_value(700)
    pg.recording_changed(True)
    assert not pg._playing                              # the option is off by default
    pg.record_check.set_active(True)
    assert w.cfg["script"]["on_record"] is True and w.saved_cfg >= 1
    pg.recording_changed(True)
    assert pg._playing and adj.get_value() == 0         # a take always starts from the top
    pg.recording_changed(False)
    assert not pg._playing
    pg.set_doc(sd.Doc("", []))
    pg.recording_changed(True)
    assert not pg._playing                              # nothing to scroll


def test_text_size_and_speed_are_remembered(page, tmp_path):
    pg, w = page
    pg.set_font(30)
    pg.set_speed(7)
    assert w.cfg["script"] == {"font": 30, "speed": 7, "on_record": False}
    again = script_ui.ScriptPage(w)
    assert again.font_px == 30 and again.speed == 7
    pg.set_font(10 ** 6)
    assert pg.font_px == script_ui.FONT_MAX
    pg.set_font(-5)
    assert pg.font_px == script_ui.FONT_MIN


def test_reload_stops_scrolling_and_flushes_first(page, tmp_path):
    pg, w = page
    pg.set_doc(sd.Doc("word " * 50, []))
    pg.buf.insert_at_cursor("tail")
    pg.start()
    first_root = None
    pg.flush()
    first_root = w.project.root
    pg.buf.insert_at_cursor("!")
    w.project = Project.create("Elsewhere", parent=tmp_path)
    pg.reload()
    assert not pg._playing
    assert sd.load(first_root / "script.json").text.startswith("tail!")  # the pending edit went to the old session
