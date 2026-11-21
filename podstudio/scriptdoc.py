"""The script, notes and outline document: formatted text that can be saved, imported and exported.

A document is plain text plus a list of formatting spans, (tag, start, end), with offsets counted in characters.
That is the same thing GTK's text buffer holds, so the editor converts to and from it directly. Everything here
works without a window so it can be tested on its own.

Import understands plain text, Markdown, and Word (.docx). Export writes Markdown or plain text.
"""
from __future__ import annotations

import json
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree as ET

MAX_BYTES = 5_000_000

INLINE = ("bold", "italic", "underline", "strike")
HIGHLIGHTS = ("hl-yellow", "hl-green", "hl-pink", "hl-blue", "hl-orange")
COLORS = ("fg-red", "fg-amber", "fg-green", "fg-blue", "fg-gray")
SIZES = ("h1", "h2", "small")
GROUPS = {"highlight": HIGHLIGHTS, "color": COLORS, "size": SIZES}
KNOWN = set(INLINE) | set(HIGHLIGHTS) | set(COLORS) | set(SIZES)


class ScriptError(Exception):
    pass


@dataclass
class Doc:
    text: str = ""
    spans: list = field(default_factory=list)          # [(tag, start, end)]

    def is_empty(self) -> bool:
        return not self.text.strip()

    def words(self) -> int:
        return len(self.text.split())


# ===================================================================== spans
def clean_spans(spans, length: int) -> list:
    """Drop unknown tags and empty or out-of-range spans, clip the rest, and merge neighbours of the same tag."""
    by_tag: dict[str, list] = {}
    for item in spans or []:
        try:
            tag, a, b = item
            a, b = int(a), int(b)
        except (TypeError, ValueError):
            continue
        if tag not in KNOWN:
            continue
        a, b = max(0, a), min(length, b)
        if b > a:
            by_tag.setdefault(tag, []).append((a, b))
    out = []
    for tag, ranges in by_tag.items():
        ranges.sort()
        cur_a, cur_b = ranges[0]
        for a, b in ranges[1:]:
            if a <= cur_b:
                cur_b = max(cur_b, b)
            else:
                out.append((tag, cur_a, cur_b))
                cur_a, cur_b = a, b
        out.append((tag, cur_a, cur_b))
    return sorted(out, key=lambda s: (s[1], s[2], s[0]))


def make_exclusive(spans: list) -> list:
    """Within a group (highlight, colour, size) the span that starts last wins where they overlap."""
    result = list(spans)
    for tags in GROUPS.values():
        members = sorted((s for s in result if s[0] in tags), key=lambda s: (s[1], s[2]))
        for i, later in enumerate(members):
            for j in range(i):
                earlier = members[j]
                if earlier in result and earlier[1] < later[2] and later[1] < earlier[2]:
                    result.remove(earlier)
                    if earlier[1] < later[1]:
                        result.append((earlier[0], earlier[1], later[1]))
                    if later[2] < earlier[2]:
                        result.append((earlier[0], later[2], earlier[2]))
    return clean_spans(result, 10 ** 9)


# ===================================================================== saving
def to_json(doc: Doc, view: dict | None = None) -> dict:
    return {"format": 1, "text": doc.text, "spans": [list(s) for s in clean_spans(doc.spans, len(doc.text))],
            "view": view or {}}


def from_json(data: dict) -> Doc:
    text = data.get("text", "")
    if not isinstance(text, str):
        raise ScriptError("The script file has no text.")
    return Doc(text, clean_spans(data.get("spans", []), len(text)))


def save(path: Path, doc: Doc, view: dict | None = None):
    """Atomic write that keeps the last good copy next to it."""
    path = Path(path)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(to_json(doc, view), ensure_ascii=False, indent=1), encoding="utf-8")
    if path.exists():
        try:
            json.loads(path.read_text(encoding="utf-8"))
            path.with_name(path.name + ".bak").write_bytes(path.read_bytes())
        except (OSError, ValueError):
            pass
    tmp.replace(path)


def load(path: Path) -> Doc:
    path = Path(path)
    for candidate in (path, path.with_name(path.name + ".bak")):
        try:
            return from_json(json.loads(candidate.read_text(encoding="utf-8")))
        except (OSError, ValueError, ScriptError):
            continue
    return Doc()


# ===================================================================== Markdown
_MARKERS = (("**", "bold"), ("__", "underline"), ("~~", "strike"), ("==", "hl-yellow"), ("*", "italic"))


def from_markdown(source: str) -> Doc:
    """Headings (#), bullets, **bold**, *italic*, __underline__, ~~strike~~ and ==highlight==. Anything else is text."""
    text_parts: list[str] = []
    spans: list = []
    pos = 0
    for raw in source.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line, size = raw, None
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            line, size = m.group(2), ("h1" if len(m.group(1)) == 1 else "h2")
        else:
            m = re.match(r"^(\s*)[-*+]\s+(.*)$", line)
            if m:
                line = f"{m.group(1)}• {m.group(2)}"
        out, line_spans = _inline(line)
        for tag, a, b in line_spans:
            spans.append((tag, pos + a, pos + b))
        if size and out:
            spans.append((size, pos, pos + len(out)))
        text_parts.append(out)
        pos += len(out) + 1
    return Doc("\n".join(text_parts), clean_spans(spans, pos))


_ESC = {"*": "\ue000", "_": "\ue001", "~": "\ue002", "=": "\ue003", "#": "\ue004", "\\": "\ue005"}
_UNESC = {v: k for k, v in _ESC.items()}
_TAG_OF = {m: t for m, t in _MARKERS}


def _marker_at(line: str, i: int):
    for marker, _tag in _MARKERS:                             # longest first: ** before *
        if line.startswith(marker, i):
            return marker
    return None


def _has_closer(line: str, start: int, marker: str) -> bool:
    j = line.find(marker, start)
    while j != -1:
        if not line[j - 1].isspace():
            return True
        j = line.find(marker, j + 1)
    return False


def _inline(line: str):
    """Parse one line. A marker closes the span of its kind when one is open and it follows a character. Otherwise
    it opens a span when a word follows and something later can close it. A marker that does neither is plain text,
    so "2 * 3" and an unclosed "**" stay as typed."""
    line = re.sub(r"\\([*_~=#\\])", lambda m: _ESC[m.group(1)], line)
    text: list[str] = []
    stack: list[list] = []                                    # open spans, innermost last: [tag, start offset]
    spans: list = []
    i = 0
    while i < len(line):
        marker = _marker_at(line, i)
        if marker is None:
            text.append(line[i])
            i += 1
            continue
        tag = _TAG_OF[marker]
        n = len(text)
        after_char = i > 0 and not line[i - 1].isspace()
        if after_char and any(t == tag for t, _ in stack):    # a closer
            if marker == "**" and line.startswith("***", i) and stack[-1][0] == "italic":
                marker, tag = "*", "italic"                   # '***' ends italic first, then bold
            idx = max(k for k, (t, _) in enumerate(stack) if t == tag)
            _, start = stack.pop(idx)
            if n > start:
                spans.append((tag, start, n))
            i += len(marker)
            continue
        after = line[i + len(marker): i + len(marker) + 1]
        if after and not after.isspace() and not any(t == tag for t, _ in stack) \
                and _has_closer(line, i + len(marker), marker):
            stack.append([tag, n])                            # an opener
            i += len(marker)
            continue
        text.append(line[i])                                  # stray marker: keep it as text
        i += 1
    for tag, start in stack:
        if len(text) > start:
            spans.append((tag, start, len(text)))
    return "".join(_UNESC.get(c, c) for c in text), spans


def _nest(events: list) -> list:
    """Split spans that cross so every span sits fully inside or outside the others."""
    work = [list(e) for e in events]
    changed = True
    while changed:
        changed = False
        for x in work:
            for y in work:
                if x[1] < y[1] < x[2] < y[2]:                 # y starts inside x and ends after it
                    work.append([y[0], x[2], y[2]])
                    y[2] = x[2]
                    changed = True
                    break
            if changed:
                break
    return [tuple(e) for e in work]


def _trim(events: list, line: str) -> list:
    """Move span edges in past spaces, because a Markdown span can't open or close on one."""
    out = []
    for tag, a, b in events:
        while a < b and line[a].isspace():
            a += 1
        while b > a and line[b - 1].isspace():
            b -= 1
        if b > a:
            out.append((tag, a, b))
    return out


def to_markdown(doc: Doc) -> str:
    """Bold, italic, underline, strike and highlight, plus headings. Colours have no Markdown form and are dropped."""
    markers = {"bold": "**", "italic": "*", "underline": "__", "strike": "~~"}
    for tag in HIGHLIGHTS:
        markers[tag] = "=="
    spans = clean_spans(doc.spans, len(doc.text))
    lines, pos = [], 0
    for line in doc.text.split("\n"):
        start, end = pos, pos + len(line)
        prefix = ""
        for tag, a, b in spans:
            if tag in ("h1", "h2") and a <= start and b >= end and line:
                prefix = "# " if tag == "h1" else "## "
        events = []
        for tag, a, b in spans:
            if tag in markers and a < end and b > start:
                events.append((tag, max(a, start) - start, min(b, end) - start))
        lines.append(prefix + _wrap_markers(line, _trim(_nest(events), line), markers))
        pos = end + 1
    return "\n".join(lines)


def _wrap_markers(line: str, events, markers) -> str:
    """Insert each span's marker. The spans are already nested, longer ones open first and close last."""
    if not events:
        return line
    cuts = sorted({0, len(line)} | {a for _, a, _ in events} | {b for _, _, b in events})
    out, stack = [], []
    for k, cut in enumerate(cuts):
        for t, a, b in sorted((e for e in events if e[2] == cut), key=lambda e: -e[1]):
            if t in stack:
                stack.remove(t)
                out.append(markers[t])
        for t, a, b in sorted((e for e in events if e[1] == cut), key=lambda e: -e[2]):
            out.append(markers[t])
            stack.append(t)
        if k + 1 < len(cuts):
            out.append(line[cut:cuts[k + 1]])
    return "".join(out)


# ===================================================================== plain text and Word
def to_plain(doc: Doc) -> str:
    return doc.text


_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_HL = {"yellow": "hl-yellow", "green": "hl-green", "brightgreen": "hl-green", "cyan": "hl-blue", "blue": "hl-blue",
       "magenta": "hl-pink", "red": "hl-pink", "darkyellow": "hl-orange", "lightgray": "hl-yellow"}


def from_docx(path: Path) -> Doc:
    try:
        with zipfile.ZipFile(path) as z:
            info = z.getinfo("word/document.xml")
            if info.file_size > 40_000_000:
                raise ScriptError("That Word file is too large.")
            root = ET.fromstring(z.read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError):
        raise ScriptError("That doesn't look like a Word (.docx) file.") from None
    parts, spans, pos = [], [], 0
    for para in root.iter(f"{_W}p"):
        ppr = para.find(f"{_W}pPr")
        style = ""
        bullet = False
        if ppr is not None:
            ps = ppr.find(f"{_W}pStyle")
            style = (ps.get(f"{_W}val") or "") if ps is not None else ""
            bullet = ppr.find(f"{_W}numPr") is not None
        line_start = pos
        text = ""
        if bullet:
            text = "• "
        pos += len(text)
        for run in para.iter(f"{_W}r"):
            rpr = run.find(f"{_W}rPr")
            piece = ""
            for el in run:
                if el.tag == f"{_W}t":
                    piece += el.text or ""
                elif el.tag == f"{_W}tab":
                    piece += "    "
                elif el.tag == f"{_W}br":
                    piece += "\n"
            if not piece:
                continue
            a, b = pos, pos + len(piece)
            if rpr is not None:
                def on(name):
                    el = rpr.find(f"{_W}{name}")
                    return el is not None and (el.get(f"{_W}val") or "true").lower() not in ("false", "0", "none")
                if on("b"):
                    spans.append(("bold", a, b))
                if on("i"):
                    spans.append(("italic", a, b))
                if on("u"):
                    spans.append(("underline", a, b))
                if on("strike"):
                    spans.append(("strike", a, b))
                hl = rpr.find(f"{_W}highlight")
                if hl is not None and hl.get(f"{_W}val") not in (None, "none"):
                    spans.append((_HL.get(hl.get(f"{_W}val"), "hl-yellow"), a, b))
            text += piece
            pos = b
        s = style.lower().replace(" ", "")
        if s in ("title", "heading1"):
            spans.append(("h1", line_start, pos))
        elif s.startswith("heading"):
            spans.append(("h2", line_start, pos))
        parts.append(text)
        pos += 1                                                 # the paragraph break
    doc_text = "\n".join(parts)
    return Doc(doc_text, clean_spans(spans, len(doc_text)))


def from_file(path: Path) -> Doc:
    """Read a script from a .txt, .md or .docx file."""
    path = Path(path)
    try:
        size = path.stat().st_size
    except OSError as e:
        raise ScriptError(f"Couldn't open that file: {e.strerror or e}") from None
    if size > MAX_BYTES:
        raise ScriptError("That file is larger than 5 MB, which is too much for a script.")
    suffix = path.suffix.lower()
    if suffix == ".docx":
        return from_docx(path)
    try:
        text = path.read_bytes().decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = path.read_bytes().decode("latin-1")
        except OSError as e:
            raise ScriptError(f"Couldn't read that file: {e.strerror or e}") from None
    except OSError as e:
        raise ScriptError(f"Couldn't read that file: {e.strerror or e}") from None
    if "\x00" in text[:2000]:
        raise ScriptError("That looks like a binary file, not a script. Use .txt, .md or .docx.")
    if suffix in (".md", ".markdown"):
        return from_markdown(text)
    return Doc(text.replace("\r\n", "\n").replace("\r", "\n"), [])
