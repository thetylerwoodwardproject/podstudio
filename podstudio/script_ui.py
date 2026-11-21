"""The Script tab: a place for the script, notes or an outline, with formatting and a teleprompter-style auto-scroll.

The text is saved with the session (script.json). Formatting is bold, italic, underline, strike-through, five
highlight colours, five text colours and heading sizes. Text can be typed, pasted, dropped in as a file or imported
from .txt, .md or .docx, and exported to Markdown or plain text.
"""
from __future__ import annotations

import time
from pathlib import Path

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, Gdk, Gio, GLib, Gtk, Pango  # noqa: E402

from . import scriptdoc as sd  # noqa: E402

HL_COLORS = {"hl-yellow": "#fde047", "hl-green": "#86efac", "hl-pink": "#f9a8d4", "hl-blue": "#93c5fd",
             "hl-orange": "#fdba74"}
FG_COLORS = {"fg-red": "#f87171", "fg-amber": "#fbbf24", "fg-green": "#4ade80", "fg-blue": "#60a5fa",
             "fg-gray": "#a1a1aa"}
NAMES = {"hl-yellow": "Yellow", "hl-green": "Green", "hl-pink": "Pink", "hl-blue": "Blue", "hl-orange": "Orange",
         "fg-red": "Red", "fg-amber": "Amber", "fg-green": "Green", "fg-blue": "Blue", "fg-gray": "Gray"}
SIZE_LABELS = (("h1", "Heading"), ("h2", "Subheading"), ("small", "Small"))
FONT_MIN, FONT_MAX, FONT_DEFAULT = 14, 56, 22
SPEED_MIN, SPEED_MAX, SPEED_DEFAULT = 1, 10, 4
WORDS_PER_MINUTE = 150                                      # for the reading-time estimate


def speed_px(level: int) -> float:
    """Pixels per second for a speed setting from 1 to 10."""
    return 14.0 * 1.32 ** (max(SPEED_MIN, min(SPEED_MAX, level)) - 1)


class ScriptPage(Gtk.Box):
    def __init__(self, win):
        super().__init__(orientation=Gtk.Orientation.VERTICAL)
        self.win = win
        self._root: Path | None = None                       # the session folder this text belongs to
        self._loading = False
        self._pending: dict[str, bool] = {}                  # formatting chosen with no selection, for the next typing
        self._pending_pos = -1
        self._syncing = False
        self._save_id = 0
        self._playing = False
        self._tick_id = 0
        self._last_t: float | None = None
        self._pos: float | None = None                       # exact scroll position (the adjustment may round it)
        self._set_value = 0.0
        self._ins_start = 0
        self._inserting = False
        cfg = win.cfg.setdefault("script", {})
        self.font_px = int(cfg.get("font", FONT_DEFAULT))
        self.speed = int(cfg.get("speed", SPEED_DEFAULT))
        self.on_record = bool(cfg.get("on_record", False))

        self.buf = Gtk.TextBuffer()
        self._make_tags()
        self.view = Gtk.TextView(buffer=self.buf, wrap_mode=Gtk.WrapMode.WORD_CHAR, left_margin=34, right_margin=34,
                                 top_margin=26, bottom_margin=220, pixels_below_lines=7, accepts_tab=False)
        self.view.add_css_class("script-view")
        self.view.set_tooltip_text("Type, paste, or drop a .txt, .md or .docx file here")
        self._css = Gtk.CssProvider()
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), self._css,
                                                  Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        self._apply_font()

        clamp = Adw.Clamp(maximum_size=1000, margin_top=14, margin_bottom=16, margin_start=16, margin_end=16, vexpand=True)
        col = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        clamp.set_child(col)
        self.append(clamp)
        col.append(self._build_toolbar())

        self.scroller = Gtk.ScrolledWindow(vexpand=True, hscrollbar_policy=Gtk.PolicyType.NEVER)
        self.scroller.set_child(self.view)
        self.hint = make_hint("Write your script, notes or outline here.\nPaste text, drop in a .txt, .md or .docx file, "
                              "or press Import.")
        over = Gtk.Overlay()
        over.set_child(self.scroller)
        over.add_overlay(self.hint)
        card = Gtk.Box(vexpand=True)
        card.add_css_class("script-card")
        card.append(over)
        over.set_hexpand(True)
        col.append(card)
        col.append(self._build_footer())

        drop = Gtk.DropTarget.new(Gio.File, Gdk.DragAction.COPY)
        drop.connect("drop", self._on_drop)
        card.add_controller(drop)

        self.buf.connect("insert-text", self._before_insert)
        self.buf.connect_after("insert-text", self._after_insert)
        self.buf.connect("changed", self._changed)
        self.buf.connect("apply-tag", self._tags_changed)
        self.buf.connect("remove-tag", self._tags_changed)
        self.buf.connect("notify::cursor-position", self._cursor_moved)
        self.buf.connect("notify::has-selection", self._cursor_moved)

        keys = Gtk.EventControllerKey()
        keys.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
        keys.connect("key-pressed", self._on_key)
        self.add_controller(keys)
        self.reload()

    # ------------------------------------------------------------------ building
    def _make_tags(self):
        t = self.buf
        t.create_tag("bold", weight=Pango.Weight.BOLD)
        t.create_tag("italic", style=Pango.Style.ITALIC)
        t.create_tag("underline", underline=Pango.Underline.SINGLE)
        t.create_tag("strike", strikethrough=True)
        t.create_tag("h1", scale=1.7, weight=Pango.Weight.BOLD, pixels_above_lines=10)
        t.create_tag("h2", scale=1.35, weight=Pango.Weight.BOLD, pixels_above_lines=6)
        t.create_tag("small", scale=0.82)
        for name, color in FG_COLORS.items():
            t.create_tag(name, foreground=color)
        for name, color in HL_COLORS.items():                # created last so the dark text wins over a text colour
            t.create_tag(name, background=color, foreground="#09090b")

    def _build_toolbar(self) -> Gtk.Widget:
        bar = Gtk.Box(spacing=6, valign=Gtk.Align.CENTER)
        bar.add_css_class("script-bar")
        self.fmt = {}
        group = Gtk.Box()
        group.add_css_class("linked")
        for name, icon, tip in (("bold", "format-text-bold-symbolic", "Bold (Ctrl+B)"),
                                ("italic", "format-text-italic-symbolic", "Italic (Ctrl+I)"),
                                ("underline", "format-text-underline-symbolic", "Underline (Ctrl+U)"),
                                ("strike", "format-text-strikethrough-symbolic", "Strike-through (Ctrl+Shift+X)")):
            b = Gtk.ToggleButton(icon_name=icon, tooltip_text=tip)
            b.add_css_class("fmt-btn")
            b.connect("toggled", lambda btn, n=name: self._on_inline(n, btn))
            self.fmt[name] = b
            group.append(b)
        bar.append(group)
        bar.append(self._swatch_menu("Highlight", "color-select-symbolic", sd.HIGHLIGHTS, HL_COLORS,
                                     "Highlight the selected words (Ctrl+Shift+H for yellow)"))
        bar.append(self._swatch_menu("Color", "font-x-generic-symbolic", sd.COLORS, FG_COLORS,
                                     "Change the color of the selected words"))
        bar.append(self._size_menu())
        clear = Gtk.Button(icon_name="edit-clear-symbolic", tooltip_text="Clear formatting from the selection")
        clear.add_css_class("fmt-btn")
        clear.connect("clicked", lambda *_: self.clear_formatting())
        bar.append(clear)
        bar.append(Gtk.Box(hexpand=True))
        for icon, tip, cb in (("edit-copy-symbolic", "Copy the selection, or the whole script", self.copy),
                              ("edit-paste-symbolic", "Paste at the cursor", self.paste),
                              ("document-open-symbolic", "Import a .txt, .md or .docx file", self.import_dialog),
                              ("document-save-symbolic", "Export as Markdown or plain text", self.export_dialog)):
            b = Gtk.Button(icon_name=icon, tooltip_text=tip)
            b.add_css_class("fmt-btn")
            b.connect("clicked", lambda *_, f=cb: f())
            bar.append(b)
        return bar

    def _swatch_menu(self, label, icon, names, colors, tip) -> Gtk.MenuButton:
        pop = Gtk.Popover()
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8, margin_top=8, margin_bottom=8,
                      margin_start=8, margin_end=8)
        row = Gtk.Box(spacing=6)
        for name in names:
            b = Gtk.Button(tooltip_text=NAMES[name])
            b.add_css_class("sw-btn")
            b.add_css_class(f"sw-{name}")
            b.connect("clicked", lambda _b, n=name, p=pop: (p.popdown(), self.choose(n)))
            row.append(b)
        box.append(row)
        none = Gtk.Button(label="None")
        none.add_css_class("chip-btn")
        none.connect("clicked", lambda *_, p=pop, g=names: (p.popdown(), self.clear_group(g)))
        box.append(none)
        pop.set_child(box)
        mb = Gtk.MenuButton(popover=pop, tooltip_text=tip)
        mb.set_child(Adw.ButtonContent(icon_name=icon, label=label))
        mb.add_css_class("fmt-menu")
        return mb

    def _size_menu(self) -> Gtk.MenuButton:
        pop = Gtk.Popover()
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2, margin_top=6, margin_bottom=6,
                      margin_start=6, margin_end=6)
        for name, label in (("", "Normal"),) + SIZE_LABELS:
            b = Gtk.Button(label=label, halign=Gtk.Align.FILL)
            b.add_css_class("flat")
            b.connect("clicked", lambda _b, n=name, p=pop: (p.popdown(), self.set_size(n)))
            box.append(b)
        pop.set_child(box)
        mb = Gtk.MenuButton(popover=pop, tooltip_text="Make the selected lines a heading or small text")
        mb.set_child(Adw.ButtonContent(icon_name="format-text-larger-symbolic", label="Size"))
        mb.add_css_class("fmt-menu")
        return mb

    def _build_footer(self) -> Gtk.Widget:
        bar = Gtk.Box(spacing=10, valign=Gtk.Align.CENTER)
        bar.add_css_class("script-bar")
        self.play_btn = Gtk.Button()
        self.play_btn.add_css_class("mix-btn")
        self.play_btn.connect("clicked", lambda *_: self.toggle_scroll())
        self.play_btn.set_tooltip_text("Scroll the script like a teleprompter (F8)")
        self.play_content = Adw.ButtonContent(icon_name="media-playback-start-symbolic", label="Auto-scroll")
        self.play_btn.set_child(self.play_content)
        bar.append(self.play_btn)
        top = Gtk.Button(icon_name="go-top-symbolic", tooltip_text="Back to the top")
        top.add_css_class("fmt-btn")
        top.connect("clicked", lambda *_: self.scroll_to_top())
        bar.append(top)
        bar.append(make_label("Speed", ["vd-sub"]))
        self.speed_scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, SPEED_MIN, SPEED_MAX, 1)
        self.speed_scale.set_value(self.speed)
        self.speed_scale.set_draw_value(False)
        self.speed_scale.set_size_request(120, -1)
        self.speed_scale.add_css_class("param")
        self.speed_scale.connect("value-changed", lambda s: self.set_speed(int(s.get_value())))
        bar.append(self.speed_scale)
        self.speed_label = make_label(str(self.speed), ["mono", "vd-sub"])
        bar.append(self.speed_label)
        bar.append(Gtk.Separator(orientation=Gtk.Orientation.VERTICAL, margin_top=4, margin_bottom=4))
        smaller = Gtk.Button(label="A−", tooltip_text="Smaller text")
        larger = Gtk.Button(label="A+", tooltip_text="Larger text")
        for b, d in ((smaller, -2), (larger, 2)):
            b.add_css_class("fmt-btn")
            b.connect("clicked", lambda *_, step=d: self.set_font(self.font_px + step))
            bar.append(b)
        self.record_check = Gtk.CheckButton(label="Start when I record", active=self.on_record,
                                            tooltip_text="Scroll from the top as soon as a take starts, "
                                                         "and stop when it ends")
        self.record_check.connect("toggled", self._on_record_check)
        bar.append(self.record_check)
        bar.append(Gtk.Box(hexpand=True))
        self.stats = make_label("", ["vd-sub"])
        bar.append(self.stats)
        return bar

    # ------------------------------------------------------------------ formatting
    def _caret(self) -> int:
        return self.buf.get_iter_at_mark(self.buf.get_insert()).get_offset()

    def _sel(self):
        if self.buf.get_has_selection():
            a, b = self.buf.get_selection_bounds()
            return a, b
        return None

    def _covers(self, a, b, name) -> bool:
        tag = self.buf.get_tag_table().lookup(name)
        it = a.copy()
        if not it.has_tag(tag):
            return False
        while it.forward_to_tag_toggle(tag) and it.compare(b) < 0:
            if not it.has_tag(tag):
                return False
        return True

    def _caret_has(self, name) -> bool:
        if name in self._pending and self._caret() == self._pending_pos:
            return self._pending[name]
        tag = self.buf.get_tag_table().lookup(name)
        it = self.buf.get_iter_at_mark(self.buf.get_insert())
        probe = it.copy()
        if not probe.backward_char():
            probe = it.copy()
        return probe.has_tag(tag)

    def _apply(self, name, on, a, b):
        table = self.buf.get_tag_table()
        group = next((g for g in sd.GROUPS.values() if name in g), None)
        if on:
            for other in group or ():
                if other != name:
                    self.buf.remove_tag_by_name(other, a, b)
            self.buf.apply_tag(table.lookup(name), a, b)
        else:
            self.buf.remove_tag(table.lookup(name), a, b)

    def _set_pending(self, name, on):
        pos = self._caret()
        if pos != self._pending_pos:
            self._pending = {}
        self._pending_pos = pos
        group = next((g for g in sd.GROUPS.values() if name in g), None)
        for other in group or ():
            if other != name:
                self._pending[other] = False
        self._pending[name] = on

    def _on_inline(self, name, btn):
        if self._syncing:
            return
        sel = self._sel()
        if sel:
            self._apply(name, not self._covers(*sel, name), *sel)
        else:
            self._set_pending(name, btn.get_active())
        self._sync_buttons()
        self.view.grab_focus()

    def toggle_inline(self, name):
        """Used by the keyboard shortcuts: flip a format on the selection, or for the next typing."""
        sel = self._sel()
        if sel:
            self._apply(name, not self._covers(*sel, name), *sel)
        else:
            self._set_pending(name, not self._caret_has(name))
        self._sync_buttons()

    def choose(self, name):
        """A highlight or text colour: applied to the selection, or to what is typed next. Choosing it again removes it."""
        sel = self._sel()
        if sel:
            self._apply(name, not self._covers(*sel, name), *sel)
        else:
            self._set_pending(name, not self._caret_has(name))
        self._sync_buttons()
        self.view.grab_focus()

    def clear_group(self, names):
        sel = self._sel()
        for n in names:
            if sel:
                self.buf.remove_tag_by_name(n, *sel)
        if not sel:
            for n in names:
                self._set_pending(n, False)
        self._sync_buttons()
        self.view.grab_focus()

    def clear_formatting(self):
        sel = self._sel()
        if sel:
            for name in sd.KNOWN:
                self.buf.remove_tag_by_name(name, *sel)
        else:
            self._pending = {n: False for n in sd.KNOWN}
            self._pending_pos = self._caret()
        self._sync_buttons()
        self.view.grab_focus()

    def set_size(self, name):
        """Sizes belong to whole lines: the selected lines, or the line the cursor is on."""
        sel = self._sel() or (self.buf.get_iter_at_mark(self.buf.get_insert()),) * 2
        a, b = sel[0].copy(), sel[1].copy()
        a.set_line_offset(0)
        if not b.ends_line():
            b.forward_to_line_end()
        for n in sd.SIZES:
            self.buf.remove_tag_by_name(n, a, b)
        if name:
            self.buf.apply_tag_by_name(name, a, b)
        self._sync_buttons()
        self.view.grab_focus()

    def _before_insert(self, buf, loc, text, length):
        self._ins_start = loc.get_offset()
        self._inserting = True                                   # the cursor is about to move because of the typing

    def _after_insert(self, buf, loc, text, length):
        """Typed text continues the formatting of the character before it (the way every editor behaves), and a
        format chosen with nothing selected is applied on top of that."""
        self._inserting = False
        if self._loading:
            return
        start = self._ins_start
        end = start + len(text)
        a, b = buf.get_iter_at_offset(start), buf.get_iter_at_offset(end)
        if start > 0:
            prev = buf.get_iter_at_offset(start - 1)
            for tag in prev.get_tags():
                name = tag.props.name
                if name in sd.SIZES and "\n" in text:
                    continue                                     # pressing Enter after a heading starts plain text
                if name in sd.KNOWN and not a.has_tag(tag):
                    buf.apply_tag(tag, a, b)
        if self._pending and self._pending_pos == start:
            for name, on in self._pending.items():
                self._apply(name, on, a, b)
        self._pending = {}

    def _cursor_moved(self, *_):
        if not self._inserting and self._caret() != self._pending_pos:
            self._pending = {}
        self._sync_buttons()

    def _sync_buttons(self):
        self._syncing = True
        try:
            sel = self._sel()
            for name, btn in self.fmt.items():
                on = self._covers(*sel, name) if sel else self._caret_has(name)
                btn.set_active(on)
        finally:
            self._syncing = False

    def _on_key(self, ctrl, keyval, keycode, state):
        name = Gdk.keyval_name(keyval) or ""
        if name == "F8":
            self.toggle_scroll()
            return True
        if self._playing:
            if name in ("space", "Escape"):
                self.stop()
                return True
            if name in ("Up", "plus", "equal"):
                self.set_speed(self.speed + 1)
                return True
            if name in ("Down", "minus"):
                self.set_speed(self.speed - 1)
                return True
            if name == "Home":
                self.scroll_to_top()
                return True
            return False
        if not self.view.has_focus():
            return False
        ctl = bool(state & Gdk.ModifierType.CONTROL_MASK)
        shift = bool(state & Gdk.ModifierType.SHIFT_MASK)
        if ctl and not shift and name.lower() in ("b", "i", "u"):
            self.toggle_inline({"b": "bold", "i": "italic", "u": "underline"}[name.lower()])
            return True
        if ctl and shift and name.lower() == "x":
            self.toggle_inline("strike")
            return True
        if ctl and shift and name.lower() == "h":
            self.choose("hl-yellow")
            return True
        return False

    # ------------------------------------------------------------------ document <-> buffer
    def _spans_for(self, name):
        tag = self.buf.get_tag_table().lookup(name)
        it = self.buf.get_start_iter()
        open_at = 0 if it.has_tag(tag) else None
        out = []
        while it.forward_to_tag_toggle(tag):
            if it.has_tag(tag):
                if open_at is None:
                    open_at = it.get_offset()
            elif open_at is not None:
                out.append((name, open_at, it.get_offset()))
                open_at = None
        if open_at is not None:
            out.append((name, open_at, self.buf.get_end_iter().get_offset()))
        return out

    def doc(self) -> sd.Doc:
        text = self.buf.get_text(self.buf.get_start_iter(), self.buf.get_end_iter(), False)
        spans = []
        for name in sorted(sd.KNOWN):
            spans.extend(self._spans_for(name))
        return sd.Doc(text, sd.clean_spans(spans, len(text)))

    def set_doc(self, doc: sd.Doc):
        self._loading = True
        try:
            self.buf.begin_irreversible_action()
            self.buf.set_text(doc.text)
            for tag, a, b in doc.spans:
                self.buf.apply_tag_by_name(tag, self.buf.get_iter_at_offset(a), self.buf.get_iter_at_offset(b))
            self.buf.place_cursor(self.buf.get_start_iter())
            self.buf.end_irreversible_action()
        finally:
            self._loading = False
        self._pending = {}
        self._update_stats()
        self.scroll_to_top()

    def append_doc(self, doc: sd.Doc):
        base = self.buf.get_end_iter().get_offset()
        gap = "\n\n" if base else ""
        self.buf.insert(self.buf.get_end_iter(), gap + doc.text)
        shift = base + len(gap)
        for tag, a, b in doc.spans:
            self.buf.apply_tag_by_name(tag, self.buf.get_iter_at_offset(a + shift), self.buf.get_iter_at_offset(b + shift))

    # ------------------------------------------------------------------ saving and loading
    def _changed(self, *_):
        if self._loading:
            return
        self._update_stats()
        self._schedule_save()

    def _tags_changed(self, *_):
        if not self._loading:
            self._schedule_save()

    def _update_stats(self):
        text = self.buf.get_text(self.buf.get_start_iter(), self.buf.get_end_iter(), False)
        words = len(text.split())
        self.hint.set_visible(not text)
        if not words:
            self.stats.set_text("")
            return
        minutes = words / WORDS_PER_MINUTE
        est = "under a minute" if minutes < 1 else f"about {round(minutes)} min"
        self.stats.set_text(f"{words:,} words  ·  {est} read aloud")

    def _schedule_save(self):
        if self._save_id:
            GLib.source_remove(self._save_id)
        self._save_id = GLib.timeout_add(1200, self._save_timer)

    def _save_timer(self):
        self._save_id = 0
        self.flush()
        return False

    def _view_settings(self) -> dict:
        return {"font": self.font_px, "speed": self.speed}

    def flush(self):
        """Write the script now. Nothing is created for an empty script that was never saved."""
        if self._save_id:
            GLib.source_remove(self._save_id)
            self._save_id = 0
        doc = self.doc()
        if self._root is None:
            if doc.is_empty():
                return
            self.win._materialize()                              # the first thing typed gives the session a folder
            self._root = self.win.project.root
            self.win._remember()
            self.win.title_label.set_text(self.win.project.name or "New session")
        try:
            self._root.mkdir(parents=True, exist_ok=True)
            sd.save(self._root / "script.json", doc, self._view_settings())
        except OSError as e:
            self.win.toast(f"Couldn't save the script: {e.strerror or e}")

    def reload(self):
        """The session changed (new, opened, or first saved): save what was here, then show that session's script."""
        if self._playing:
            self.stop()
        if self._save_id or self._root is not None:
            self.flush()
        proj = self.win.project
        self._root = proj.root if proj.created else None
        self.set_doc(sd.load(self._root / "script.json") if self._root else sd.Doc())

    def adopt(self, root: Path):
        """A new take got its own session folder: from now on the script saves there, and starts with a copy."""
        self.flush()
        self._root = Path(root)
        self.flush()

    # ------------------------------------------------------------------ clipboard, import, export
    def copy(self):
        clip = self.get_clipboard()
        if self.buf.get_has_selection():
            self.buf.copy_clipboard(clip)
            self.win.toast("Copied the selection")
        else:
            text = self.doc().text
            if text:
                clip.set(text)
                self.win.toast("Copied the whole script")

    def paste(self):
        if self._playing:
            return
        self.buf.paste_clipboard(self.get_clipboard(), None, True)
        self.view.grab_focus()

    def import_dialog(self):
        dlg = Gtk.FileDialog(title="Import a script")
        f = Gtk.FileFilter(name="Scripts and notes (.txt, .md, .docx)")
        for suffix in ("txt", "text", "md", "markdown", "docx"):
            f.add_suffix(suffix)
        every = Gtk.FileFilter(name="All files")
        every.add_pattern("*")
        flt = Gio.ListStore.new(Gtk.FileFilter)
        flt.append(f)
        flt.append(every)
        dlg.set_filters(flt)

        def done(d, res):
            try:
                gf = d.open_finish(res)
            except GLib.Error:
                return
            self.import_path(Path(gf.get_path()))

        dlg.open(self.win, None, done)

    def import_path(self, path: Path, mode: str | None = None):
        """Read a file into the script. If there is already text, asks whether to replace it or add to the end;
        `mode` ("replace" or "append") skips the question."""
        try:
            doc = sd.from_file(path)
        except sd.ScriptError as e:
            self.win.toast(str(e))
            return
        if doc.is_empty():
            self.win.toast("That file has no text in it.")
            return
        if mode is None and not self.doc().is_empty():
            self._ask_replace(path, doc)
            return
        if mode == "append":
            self.append_doc(doc)
        else:
            self.set_doc(doc)
        self.flush()
        self.win.toast(f"Imported {doc.words():,} words from {path.name}")

    def _ask_replace(self, path: Path, doc: sd.Doc):
        d = Adw.AlertDialog(heading="Add this to your script?",
                            body=f"“{path.name}” has {doc.words():,} words. Replace what's here, or add it to the end?")
        d.add_response("cancel", "Cancel")
        d.add_response("append", "Add to end")
        d.add_response("replace", "Replace script")
        d.set_response_appearance("replace", Adw.ResponseAppearance.DESTRUCTIVE)
        d.set_default_response("append")
        d.set_close_response("cancel")

        def chosen(dialog, res):
            answer = dialog.choose_finish(res)
            if answer in ("append", "replace"):
                self.import_path(path, answer)

        d.choose(self.win, None, chosen)

    def _on_drop(self, target, value, x, y):
        path = value.get_path() if value else None
        if not path:
            return False
        self.import_path(Path(path))
        return True

    def export_dialog(self):
        if self.doc().is_empty():
            self.win.toast("There is nothing to export yet.")
            return
        dlg = Gtk.FileDialog(title="Export the script")
        name = (self.win.project.name or "script").strip() or "script"
        dlg.set_initial_name(f"{name} script.md")

        def done(d, res):
            try:
                gf = d.save_finish(res)
            except GLib.Error:
                return
            self.export_path(Path(gf.get_path()))

        dlg.save(self.win, None, done)

    def export_path(self, path: Path):
        doc = self.doc()
        body = sd.to_plain(doc) if path.suffix.lower() == ".txt" else sd.to_markdown(doc)
        try:
            path.write_text(body + "\n", encoding="utf-8")
        except OSError as e:
            self.win.toast(f"Couldn't export: {e.strerror or e}")
            return
        self.win.toast(f"Exported to {path.name}")

    # ------------------------------------------------------------------ view settings
    def _apply_font(self):
        self._css.load_from_string(f"textview.script-view {{ font-size: {self.font_px}px; }}")

    def set_font(self, px: int):
        self.font_px = max(FONT_MIN, min(FONT_MAX, px))
        self._apply_font()
        self._remember_view()

    def set_speed(self, level: int):
        self.speed = max(SPEED_MIN, min(SPEED_MAX, level))
        if int(self.speed_scale.get_value()) != self.speed:
            self.speed_scale.set_value(self.speed)
        self.speed_label.set_text(str(self.speed))
        self._remember_view()

    def _on_record_check(self, btn):
        self.on_record = btn.get_active()
        self._remember_view()

    def _remember_view(self):
        self.win.cfg["script"] = {"font": self.font_px, "speed": self.speed, "on_record": self.on_record}
        self.win.save_cfg()

    # ------------------------------------------------------------------ auto-scroll
    def toggle_scroll(self):
        (self.stop if self._playing else self.start)()

    def start(self):
        if self._playing:
            return
        if self.doc().is_empty():
            self.win.toast("Write or import a script first.")
            return
        self._playing = True
        self._last_t = None
        self._pos = None
        self.view.set_editable(False)
        self.view.set_cursor_visible(False)
        self.view.add_css_class("scrolling")
        self.play_content.set_label("Pause")
        self.play_content.set_icon_name("media-playback-pause-symbolic")
        self._tick_id = self.win.add_tick_callback(self._tick)       # the window's clock runs even when this tab is hidden

    def stop(self):
        if not self._playing:
            return
        self._playing = False
        if self._tick_id:
            self.win.remove_tick_callback(self._tick_id)
            self._tick_id = 0
        self.view.set_editable(True)
        self.view.set_cursor_visible(True)
        self.view.remove_css_class("scrolling")
        self.play_content.set_label("Auto-scroll")
        self.play_content.set_icon_name("media-playback-start-symbolic")

    def _tick(self, widget, clock):
        now = clock.get_frame_time() / 1e6
        dt = 0.0 if self._last_t is None else min(now - self._last_t, 0.1)
        self._last_t = now
        return self.advance(dt)

    def advance(self, dt: float) -> bool:
        """Move the text up by `dt` seconds' worth. Returns False (and stops) once the end is reached."""
        adj = self.scroller.get_vadjustment()
        end = max(0.0, adj.get_upper() - adj.get_page_size())
        current = adj.get_value()
        if self._pos is None or abs(current - self._set_value) > 1.5:     # first step, or the user scrolled by hand
            self._pos = current
        if self._pos >= end - 0.5:
            self._tick_id = 0                                          # returning False removes the callback
            self.stop()
            self.win.toast("Reached the end of the script")
            return False
        self._pos = min(end, self._pos + speed_px(self.speed) * dt)
        adj.set_value(self._pos)
        self._set_value = adj.get_value()
        return True

    def scroll_to_top(self):
        self.scroller.get_vadjustment().set_value(0)

    def recording_changed(self, recording: bool):
        """A take started or ended. If the option is on, the script scrolls from the top while recording."""
        if recording:
            if self.on_record and not self.doc().is_empty():
                self.stop()
                self.scroll_to_top()
                self.start()
        else:
            self.stop()


def make_hint(text: str) -> Gtk.Label:
    lab = Gtk.Label(label=text, justify=Gtk.Justification.CENTER, halign=Gtk.Align.CENTER, valign=Gtk.Align.CENTER,
                    can_target=False, can_focus=False)
    lab.add_css_class("script-hint")
    return lab


def make_label(text="", css=(), xalign=0.5, **kw) -> Gtk.Label:
    lab = Gtk.Label(label=text, xalign=xalign, **kw)
    for c in css:
        lab.add_css_class(c)
    return lab
