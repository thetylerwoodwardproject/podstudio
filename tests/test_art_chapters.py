import pytest

gi = pytest.importorskip("gi")
gi.require_version("GdkPixbuf", "2.0")
from gi.repository import GdkPixbuf  # noqa: E402

from podstudio import artwork, chapters as ch  # noqa: E402
from podstudio.project import Project, list_sessions  # noqa: E402


def png(path, w, h):
    GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, False, 8, w, h).savev(str(path), "png", [], [])
    return path


def test_artwork_accepts_a_good_cover(tmp_path):
    i = artwork.inspect(png(tmp_path / "c.png", 1400, 1400))
    assert i.ok and not i.warnings and i.summary.startswith("1400 × 1400 PNG")


def test_artwork_warns_but_allows_odd_sizes(tmp_path):
    i = artwork.inspect(png(tmp_path / "c.png", 800, 600))
    assert i.ok and any("square" in w for w in i.warnings) and any("1400" in w for w in i.warnings)
    assert any("3000" in w for w in artwork.inspect(png(tmp_path / "big.png", 3200, 3200)).warnings)


def test_artwork_rejects_non_images_and_wrong_formats(tmp_path):
    (tmp_path / "x.png").write_bytes(b"definitely not a picture")
    assert not artwork.inspect(tmp_path / "x.png").ok
    gif = tmp_path / "a.gif"
    GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, False, 8, 10, 10).savev(str(gif), "bmp", [], [])
    assert not artwork.inspect(gif).ok                                   # BMP is not JPEG/PNG
    assert not artwork.inspect(tmp_path / "missing.png").ok


def test_artwork_is_copied_into_the_session_and_replaced(tmp_path):
    p = Project.create("art", parent=tmp_path / "s")
    artwork.import_art(p, png(tmp_path / "one.png", 1400, 1400))
    assert p.art == "art/cover.png" and p.art_path.exists()
    artwork.import_art(p, png(tmp_path / "two.png", 1500, 1500))
    assert len(list((p.root / "art").iterdir())) == 1                   # the old cover is replaced, not piled up
    p.save()
    assert Project.load(p.root).art == "art/cover.png"


def test_time_parsing_and_formatting():
    assert ch.parse_time("90") == 90 and ch.parse_time("1:30") == 90 and ch.parse_time("1:02:03") == 3723
    assert ch.parse_time("0:05.5") == 5.5 and ch.parse_time(" 2:00 ") == 120
    assert ch.parse_time("1:75") is None and ch.parse_time("abc") is None and ch.parse_time("") is None
    assert ch.fmt_time(0) == "0:00" and ch.fmt_time(754) == "12:34" and ch.fmt_time(3723) == "1:02:03"
    assert ch.fmt_time(65.37, tenths=True) == "1:05.3"


def test_normalize_sorts_adds_intro_and_reports_changes():
    out, notes = ch.normalize([{"t": 300, "title": "Interview"}, {"t": 60, "title": "Topic one"}, {"t": 500, "title": ""}], 900)
    assert [(c["t"], c["title"]) for c in out] == [(0.0, "Intro"), (60.0, "Topic one"), (300.0, "Interview")]
    assert any("Intro" in n for n in notes) and any("no title" in n for n in notes)


def test_normalize_drops_chapters_past_the_end_and_duplicates():
    out, notes = ch.normalize([{"t": 0, "title": "A"}, {"t": 0.4, "title": "B"}, {"t": 100, "title": "C"}, {"t": 5000, "title": "D"}], 600)
    assert [c["title"] for c in out] == ["A", "C"]
    assert any("after the episode ends" in n for n in notes) and any("within a second" in n for n in notes)
    assert ch.normalize([], 100) == ([], [])


def test_sessions_are_listed_newest_first_and_bad_ones_skipped(tmp_path):
    a = Project.create("older", parent=tmp_path); a.mic_duration = 61; a.save()
    import os, time
    time.sleep(0.02)
    b = Project.create("newer", parent=tmp_path); b.save()
    os.utime(a.file, (1, 1))
    (tmp_path / "broken").mkdir(); (tmp_path / "broken" / "project.json").write_text("{not json")
    rows = list_sessions(tmp_path)
    assert [r["name"] for r in rows] == ["newer", "older"] and rows[1]["duration"] == 61
