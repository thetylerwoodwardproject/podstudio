"""The script document: spans, saving, Markdown and Word import and export. No window needed."""
import json
import zipfile

import pytest

from podstudio import scriptdoc as sd


def test_clean_spans_clips_merges_and_drops_junk():
    spans = [("bold", 0, 3), ("bold", 3, 6), ("bold", 10, 99), ("nonsense", 0, 2), ("italic", 5, 5), ("italic", "x", 2),
             ("underline", -4, 2), ("bold", 8, 8)]
    got = sd.clean_spans(spans, 12)
    assert ("bold", 0, 6) in got                       # touching spans merge
    assert ("bold", 10, 12) in got                     # clipped to the text
    assert ("underline", 0, 2) in got                  # negative start clipped
    assert not [s for s in got if s[0] in ("nonsense", "italic")]
    assert sd.clean_spans(None, 5) == []


def test_exclusive_groups_keep_the_latest_highlight_where_they_overlap():
    got = sd.make_exclusive([("hl-yellow", 0, 10), ("hl-pink", 4, 6), ("bold", 0, 10)])
    assert ("hl-pink", 4, 6) in got
    assert ("hl-yellow", 0, 4) in got and ("hl-yellow", 6, 10) in got
    assert ("hl-yellow", 0, 10) not in got
    assert ("bold", 0, 10) in got                      # other groups are untouched


def test_save_and_load_round_trip_and_atomic_backup(tmp_path):
    f = tmp_path / "script.json"
    doc = sd.Doc("Hello world\nSecond line", [("bold", 0, 5), ("hl-green", 6, 11), ("h1", 12, 23)])
    sd.save(f, doc, {"font": 22})
    assert sd.load(f) == doc
    assert json.loads(f.read_text())["view"] == {"font": 22}
    sd.save(f, sd.Doc("Changed", []))
    assert (tmp_path / "script.json.bak").exists()
    assert sd.load(f).text == "Changed"
    f.write_text("{ this is not json")                  # damaged: the last good copy comes back
    assert sd.load(f).text == "Hello world\nSecond line"
    assert not (tmp_path / "script.tmp").exists()


def test_load_of_nothing_or_garbage_is_an_empty_script(tmp_path):
    assert sd.load(tmp_path / "missing.json").is_empty()
    (tmp_path / "bad.json").write_text(json.dumps({"text": 5}))
    assert sd.load(tmp_path / "bad.json").is_empty()


def test_markdown_import_formats_and_headings():
    d = sd.from_markdown("# Title\n## Part\nSome **bold**, *italic*, __under__, ~~gone~~ and ==marked==.\n- item")
    assert d.text.split("\n")[0] == "Title"
    tags = {t for t, _, _ in d.spans}
    assert {"h1", "h2", "bold", "italic", "underline", "strike", "hl-yellow"} <= tags
    bold = next(s for s in d.spans if s[0] == "bold")
    assert d.text[bold[1]:bold[2]] == "bold"
    assert "• item" in d.text


def test_markdown_treats_stray_and_escaped_markers_as_text():
    d = sd.from_markdown("2 * 3 is six, snake_case stays, and \\*not italic\\* here, **never closed")
    assert d.text == "2 * 3 is six, snake_case stays, and *not italic* here, **never closed"
    assert d.spans == []


def _coverage(doc):
    """For every visible (non-space) character, the set of tags on it."""
    spans = sd.clean_spans(doc.spans, len(doc.text))
    return [(c, frozenset(t for t, a, b in spans if a <= i < b)) for i, c in enumerate(doc.text) if not c.isspace()]


def test_markdown_export_nests_and_round_trips_overlapping_spans():
    doc = sd.Doc("one two three", [("bold", 0, 7), ("italic", 4, 13)])        # they cross at 4..7
    md = sd.to_markdown(doc)
    again = sd.from_markdown(md)
    assert again.text == doc.text
    assert _coverage(again) == _coverage(doc)


def test_markdown_round_trip_of_a_busy_script():
    doc = sd.Doc("Intro line\nSay hello to everyone, then pause.\nOutro",
                 [("h1", 0, 10), ("bold", 15, 20), ("italic", 15, 36), ("underline", 28, 40), ("strike", 41, 46),
                  ("hl-yellow", 16, 31)])
    again = sd.from_markdown(sd.to_markdown(doc))
    assert again.text == doc.text
    assert _coverage(again) == _coverage(sd.Doc(doc.text, [(t if not t.startswith("hl") else "hl-yellow", a, b)
                                                           for t, a, b in doc.spans]))


def test_markdown_export_headings_highlights_and_dropped_colours():
    doc = sd.Doc("Big\nsee this red", [("h1", 0, 3), ("hl-pink", 4, 12), ("fg-red", 13, 16)])
    md = sd.to_markdown(doc)
    assert md.startswith("# Big\n")
    assert "==see this==" in md
    assert "red" in md and "fg" not in md              # colour has no Markdown form, the words stay


def test_plain_text_export_is_just_the_words():
    assert sd.to_plain(sd.Doc("a\nb", [("bold", 0, 1)])) == "a\nb"


def _docx(path, body_xml):
    ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    xml = f'<?xml version="1.0"?><w:document {ns}><w:body>{body_xml}</w:body></w:document>'
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("word/document.xml", xml)
    return path


def test_docx_import_runs_headings_bullets_and_highlight(tmp_path):
    body = (
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Episode plan</w:t></w:r></w:p>'
        '<w:p><w:r><w:t xml:space="preserve">Say </w:t></w:r>'
        '<w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>hello</w:t></w:r>'
        '<w:r><w:rPr><w:highlight w:val="green"/></w:rPr><w:t> loudly</w:t></w:r></w:p>'
        '<w:p><w:pPr><w:numPr/></w:pPr><w:r><w:rPr><w:u w:val="single"/><w:strike/></w:rPr><w:t>point</w:t></w:r></w:p>'
    )
    d = sd.from_docx(_docx(tmp_path / "s.docx", body))
    assert d.text == "Episode plan\nSay hello loudly\n• point"
    got = {(t, d.text[a:b]) for t, a, b in d.spans}
    assert ("h1", "Episode plan") in got
    assert ("bold", "hello") in got and ("italic", "hello") in got
    assert ("hl-green", " loudly") in got
    assert ("underline", "point") in got and ("strike", "point") in got


def test_docx_that_is_not_a_docx_is_refused_kindly(tmp_path):
    f = tmp_path / "fake.docx"
    f.write_text("just text")
    with pytest.raises(sd.ScriptError, match="Word"):
        sd.from_docx(f)
    z = tmp_path / "other.docx"
    with zipfile.ZipFile(z, "w") as zz:
        zz.writestr("hello.txt", "x")
    with pytest.raises(sd.ScriptError):
        sd.from_docx(z)


def test_from_file_picks_the_reader_by_extension(tmp_path):
    (tmp_path / "a.txt").write_text("line one\r\nline two\r\n", encoding="utf-8")
    (tmp_path / "b.md").write_text("**hi**", encoding="utf-8")
    (tmp_path / "c.txt").write_bytes("caf\xe9".encode("latin-1"))
    (tmp_path / "d.txt").write_bytes("﻿bom text".encode("utf-8"))
    assert sd.from_file(tmp_path / "a.txt").text == "line one\nline two\n"
    assert sd.from_file(tmp_path / "b.md").spans == [("bold", 0, 2)]
    assert sd.from_file(tmp_path / "c.txt").text == "caf\xe9"
    assert sd.from_file(tmp_path / "d.txt").text == "bom text"


def test_from_file_refuses_binary_huge_and_missing(tmp_path):
    (tmp_path / "blob.txt").write_bytes(b"abc\x00\x01\x02" * 50)
    with pytest.raises(sd.ScriptError, match="binary"):
        sd.from_file(tmp_path / "blob.txt")
    big = tmp_path / "big.txt"
    big.write_bytes(b"a" * (sd.MAX_BYTES + 1))
    with pytest.raises(sd.ScriptError, match="5 MB"):
        sd.from_file(big)
    with pytest.raises(sd.ScriptError, match="open"):
        sd.from_file(tmp_path / "nope.txt")


def test_word_count():
    assert sd.Doc("one two\nthree", []).words() == 3
    assert sd.Doc("   \n ", []).is_empty()
