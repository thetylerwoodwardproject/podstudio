"""Recordings tab: browse sessions, preview any stem or the master in the app, and set chapters while listening."""
from __future__ import annotations

import threading
import time
from pathlib import Path

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
gi.require_version("Graphene", "1.0")
gi.require_version("Gsk", "4.0")
from gi.repository import Gdk, Gio, GLib, Graphene, Gsk, Gtk, Pango  # noqa: E402

from . import audio, chapters as chap
from .project import DEFAULT_ROOT, Project, list_sessions

SKIP_SECONDS = 5.0
TRACKS = [("master", "Master"), ("mic", "Mic"), ("clean", "Cleaned mic"), ("hotkeys", "Hotkeys"), ("mp3", "MP3")]


def _rgba(spec: str) -> Gdk.RGBA:
    c = Gdk.RGBA()
    c.parse(spec)
    return c


def _label(text="", css=(), xalign=0.0, **kw) -> Gtk.Label:
    lb = Gtk.Label(label=text, xalign=xalign, **kw)
    for c in css:
        lb.add_css_class(c)
    return lb


def _icon_btn(icon: str, tip: str, css=("flat",)) -> Gtk.Button:
    b = Gtk.Button(icon_name=icon, tooltip_text=tip, valign=Gtk.Align.CENTER)
    for c in css:
        b.add_css_class(c)
    return b


def _ignore_scroll(scale: Gtk.Scale) -> Gtk.Scale:
    ctrl = Gtk.EventControllerScroll(flags=Gtk.EventControllerScrollFlags.BOTH_AXES)
    ctrl.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
    ctrl.connect("scroll", lambda *_: True)
    scale.add_controller(ctrl)
    return scale


# ===================================================================== waveform
class WaveformView(Gtk.Widget):
    """Peaks, a playhead, hotkey-hit markers and chapter flags. Click or drag to seek."""

    __gtype_name__ = "PodStudioWaveform"

    def __init__(self, on_seek):
        super().__init__()
        self.on_seek = on_seek
        self.peaks = None
        self.duration = 0.0
        self.pos = 0.0
        self.hits: list[tuple[float, str]] = []
        self.chapter_times: list[float] = []
        self.loading = False
        self.set_size_request(-1, 150)
        self.set_hexpand(True)
        self.set_cursor(Gdk.Cursor.new_from_name("pointer"))
        drag = Gtk.GestureDrag()
        drag.connect("drag-begin", self._begin)
        drag.connect("drag-update", self._update)
        self.add_controller(drag)
        self._x0 = 0.0
        self._colors = {k: _rgba(v) for k, v in {"played": "#fafafa", "rest": "#52525b", "mid": "rgba(255,255,255,0.10)",
                                                  "head": "#ffffff", "chapter": "#f59e0b", "load": "rgba(255,255,255,0.35)"}.items()}

    def set_data(self, peaks, duration, hits, chapter_times):
        self.peaks, self.duration, self.hits, self.chapter_times = peaks, duration or 0.0, hits, chapter_times
        self.queue_draw()

    def set_position(self, pos: float):
        self.pos = pos
        self.queue_draw()

    def _seek_to_x(self, x: float):
        w = max(self.get_width(), 1)
        if self.duration > 0:
            self.on_seek(min(max(x / w, 0.0), 1.0) * self.duration)

    def _begin(self, _g, x, _y):
        self._x0 = x
        self._seek_to_x(x)

    def _update(self, _g, dx, _dy):
        self._seek_to_x(self._x0 + dx)

    def do_snapshot(self, snap):
        w, h = self.get_width(), self.get_height()
        if w <= 0 or h <= 0:
            return
        rect = Graphene.Rect()
        mid = h / 2
        snap.append_color(self._colors["mid"], rect.init(0, mid, w, 1))
        if self.peaks is None:
            if self.loading:
                snap.append_color(self._colors["load"], rect.init(w * 0.45, mid - 1, w * 0.10, 2))
            return
        n = len(self.peaks)
        peak = max(float(abs(self.peaks).max()), 0.1)              # quiet takes still show, noise floors don't balloon
        head_x = (self.pos / self.duration * w) if self.duration else 0
        step, bar = 3, 2
        for x in range(0, w, step):
            lo, hi = self.peaks[min(n - 1, int(x * n / w))]
            top = mid - max(hi / peak, 0.0) * (mid - 6)
            bot = mid - min(lo / peak, 0.0) * (mid - 6)
            snap.append_color(self._colors["played" if x < head_x else "rest"], rect.init(x, top, bar, max(bot - top, 2)))
        if self.duration:
            for t, color in self.hits:
                snap.append_color(_rgba(color), rect.init(t / self.duration * w - 1, 0, 3, 9))
            for t in self.chapter_times:
                x = t / self.duration * w
                snap.append_color(self._colors["chapter"], rect.init(x, 0, 1, h))
                snap.append_color(self._colors["chapter"], rect.init(x, 0, 7, 7))
        snap.append_color(self._colors["head"], rect.init(head_x - 1, 0, 2, h))


# ===================================================================== page
class RecordingsPage(Gtk.Box):
    def __init__(self, win, sink: str = "autoaudiosink"):
        super().__init__(spacing=16, margin_top=16, margin_bottom=16, margin_start=16, margin_end=16)
        self.add_css_class("vd-page")
        self.win = win
        self.player = audio.Player(on_eos=self._on_eos, on_error=lambda m: win.toast(f"Playback error: {m}"), sink=sink)
        self.sel_path: Path | None = None
        self._loaded: Project | None = None
        self.track = "master"
        self._peaks_cache: dict = {}
        self._rebuilding = False
        self._tracks: dict[str, Gtk.ToggleButton] = {}

        # ---- left: sessions
        left = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        left.set_size_request(300, -1)
        left.append(_label("Sessions", ["vd-title"]))
        self.listbox = Gtk.ListBox(selection_mode=Gtk.SelectionMode.SINGLE)
        self.listbox.add_css_class("session-list")
        self.listbox.connect("row-selected", self._on_row_selected)
        sw = Gtk.ScrolledWindow(hscrollbar_policy=Gtk.PolicyType.NEVER, vexpand=True)
        sw.set_child(self.listbox)
        left.append(sw)
        rb = Gtk.Button(label="Recover from folder…", tooltip_text="Repair a session that isn't in this list")
        rb.add_css_class("chip-btn")
        rb.connect("clicked", lambda *_: self.win.recover_folder())
        left.append(rb)
        self.append(left)

        # ---- right: player + chapters
        right = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12, hexpand=True)
        head = Gtk.Box(spacing=8)
        titles = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2, hexpand=True)
        self.title = _label("No recordings yet", ["vd-title"], ellipsize=Pango.EllipsizeMode.END)
        self.meta = _label("", ["vd-sub"])
        titles.append(self.title)
        titles.append(self.meta)
        head.append(titles)
        self.open_btn = Gtk.Button(label="Open session", valign=Gtk.Align.CENTER, tooltip_text="Make this the active session")
        self._status: dict = {}
        self.open_btn.add_css_class("chip-btn")
        self.open_btn.connect("clicked", lambda *_: self._open_selected())
        self.folder_btn = Gtk.Button(label="Show folder", valign=Gtk.Align.CENTER)
        self.folder_btn.add_css_class("chip-btn")
        self.folder_btn.connect("clicked", lambda *_: self._show_folder())
        head.append(self.open_btn)
        head.append(self.folder_btn)
        right.append(head)

        player = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        player.add_css_class("vd-panel")
        player.add_css_class("card-pad")
        seg = Gtk.Box(css_classes=["linked", "seg"], halign=Gtk.Align.START)
        first = None
        for key, name in TRACKS:
            b = Gtk.ToggleButton(label=name, group=first)
            b.add_css_class("chip-btn")
            first = first or b
            b.connect("toggled", lambda btn, k=key: btn.get_active() and self._pick_track(k))
            seg.append(b)
            self._tracks[key] = b
        player.append(seg)

        self.wave = WaveformView(self._seek)
        frame = Gtk.Box(css_classes=["wave-frame"])
        frame.append(self.wave)
        player.append(frame)

        bar = Gtk.Box(spacing=6)
        self.time_lbl = _label("0:00 / 0:00", ["mono", "time-label"], width_chars=14)
        bar.append(self.time_lbl)
        bar.append(Gtk.Box(hexpand=True))
        self.prev_hit = _icon_btn("go-previous-symbolic", "Previous hotkey hit")
        self.back_btn = _icon_btn("media-seek-backward-symbolic", "Back 5 seconds (←)")
        self.play_btn = Gtk.Button(icon_name="media-playback-start-symbolic", tooltip_text="Play / pause (Space)", valign=Gtk.Align.CENTER)
        self.play_btn.add_css_class("play-btn")
        self.fwd_btn = _icon_btn("media-seek-forward-symbolic", "Forward 5 seconds (→)")
        self.next_hit = _icon_btn("go-next-symbolic", "Next hotkey hit")
        self.prev_hit.connect("clicked", lambda *_: self._jump_hit(-1))
        self.next_hit.connect("clicked", lambda *_: self._jump_hit(+1))
        self.back_btn.connect("clicked", lambda *_: self._nudge(-SKIP_SECONDS))
        self.fwd_btn.connect("clicked", lambda *_: self._nudge(+SKIP_SECONDS))
        self.play_btn.connect("clicked", lambda *_: self.toggle())
        for w in (self.prev_hit, self.back_btn, self.play_btn, self.fwd_btn, self.next_hit):
            bar.append(w)
        bar.append(Gtk.Box(hexpand=True))
        bar.append(_label("Volume", ["vd-sub"]))
        self.vol = _ignore_scroll(Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, 1.0, 0.01))
        self.vol.add_css_class("param")
        self.vol.set_value(0.9)
        self.vol.set_size_request(110, -1)
        self.vol.connect("value-changed", lambda s: self.player.set_volume(s.get_value()))
        bar.append(self.vol)
        player.append(bar)
        self.note = _label("", ["vd-sub"], wrap=True)
        player.append(self.note)
        right.append(player)

        # ---- chapters
        ch_card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        ch_card.add_css_class("vd-panel")
        ch_card.add_css_class("card-pad")
        ch_head = Gtk.Box(spacing=8)
        ch_head.append(_label("Chapters", ["card-title"], hexpand=True))
        self.add_ch_btn = Gtk.Button(label="Add chapter here", valign=Gtk.Align.CENTER, tooltip_text="Add a chapter at the playhead")
        self.add_ch_btn.add_css_class("mix-btn")
        self.add_ch_btn.connect("clicked", lambda *_: self.add_chapter_here())
        ch_head.append(self.add_ch_btn)
        ch_card.append(ch_head)
        self.ch_hint = _label("", ["vd-sub"], wrap=True)
        ch_card.append(self.ch_hint)
        self.ch_list = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        ch_scroll = Gtk.ScrolledWindow(hscrollbar_policy=Gtk.PolicyType.NEVER, min_content_height=60, vexpand=True)
        ch_scroll.set_child(self.ch_list)
        ch_card.append(ch_scroll)
        right.append(ch_card)
        self.append(right)

        GLib.timeout_add(60, self._tick)
        self._set_controls(False)
        self.refresh()

    # ------------------------------------------------------------------ project plumbing
    @property
    def project(self) -> Project | None:
        """The previewed session: the live active project when it is the same folder, else a loaded copy."""
        if self.sel_path is None:
            return None
        active = self.win.project
        if active is not None and active.created and Path(active.root) == self.sel_path:
            return active
        return self._loaded

    def _files(self) -> dict[str, Path]:
        p = self.project
        return {} if p is None else {"master": p.master_path, "mic": p.mic_path, "clean": p.clean_path,
                                     "hotkeys": p.hotkeys_path, "mp3": p.mp3_path}

    def _exists(self, path: Path) -> bool:
        return path.exists() and path.stat().st_size > 44

    # ------------------------------------------------------------------ session list
    def refresh(self):
        """Re-read the session list (cheap) and refresh the player's view of the selected session."""
        sessions = list_sessions(DEFAULT_ROOT)
        active = Path(self.win.project.root) if self.win.project and self.win.project.created else None
        self._status = {s["path"]: s["status"] for s in sessions}
        self._rebuilding = True
        while (r := self.listbox.get_first_child()) is not None:
            self.listbox.remove(r)
        chosen = None
        for s in sessions:
            row = Gtk.ListBoxRow()
            row.session = s
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2, margin_top=10, margin_bottom=10, margin_start=12, margin_end=12)
            top = Gtk.Box(spacing=6)
            top.append(_label(s["name"], ["session-title"], hexpand=True, ellipsize=Pango.EllipsizeMode.END))
            if s["status"] != "ok":
                top.append(_label("Needs recovery", ["pill", "warn"]))
            elif active and s["path"] == active:
                top.append(_label("Active", ["pill", "ok"]))
            box.append(top)
            bits = [s["created"][:16].replace("-", "/") if s["created"] else "", chap.fmt_time(s["duration"]) if s["duration"] else "no audio"]
            if s["lufs"] is not None:
                bits.append(f"{s['lufs']:.1f} LUFS")
            box.append(_label("  ·  ".join(b for b in bits if b), ["vd-sub"]))
            row.set_child(box)
            self.listbox.append(row)
            if self.sel_path == s["path"]:
                chosen = row
        if chosen is None and sessions:
            want = next((r for r in self._rows() if active and r.session["path"] == active), None) or self.listbox.get_row_at_index(0)
            chosen = want
        if chosen is not None:
            self.listbox.select_row(chosen)                  # still muted by _rebuilding: no spurious reload
            self._rebuilding = False
            if self.sel_path != chosen.session["path"]:
                self.select(chosen.session["path"])
            else:
                self._after_files_changed()
        elif not sessions:
            self._rebuilding = False
            self.sel_path = None
            self._set_controls(False)
            self.title.set_text("No recordings yet")
            self.meta.set_text("Record a take on the Session tab and it will show up here.")
            self._rebuild_chapters()

    def _rows(self):
        r, out = self.listbox.get_first_child(), []
        while r is not None:
            out.append(r)
            r = r.get_next_sibling()
        return out

    def _on_row_selected(self, _lb, row):
        if self._rebuilding or row is None:
            return
        # GTK delivers the selection signal after a list rebuild, past any "rebuilding" flag. Re-selecting the session
        # that is already open must not reload it, or every refresh would snap playback back to the start.
        if row.session["path"] == self.sel_path:
            return
        self.select(row.session["path"])

    def select(self, path: Path):
        self.player.pause()
        self.sel_path = Path(path)
        status = getattr(self, "_status", {}).get(self.sel_path, "ok")
        if status != "ok":
            self._show_needs_recovery(status)
            return
        active = self.win.project
        if active is not None and active.created and Path(active.root) == self.sel_path:
            self._loaded = None
        else:
            try:
                self._loaded = Project.load(self.sel_path)
            except Exception as e:
                self.win.toast(f"Couldn't open that session: {e}")
                return
        p = self.project
        self.open_btn.set_label("Open session")
        self.open_btn.set_tooltip_text("Make this the active session")
        self.title.set_text(p.name or self.sel_path.name)
        self.meta.set_text(f"{p.created}  ·  {chap.fmt_time(p.mic_duration)}" if p.mic_duration else p.created)
        is_active = p is self.win.project
        self.open_btn.set_sensitive(not is_active)
        files = self._files()
        for key, btn in self._tracks.items():
            btn.set_sensitive(self._exists(files[key]))
        pick = self.track if self._exists(files[self.track]) else next((k for k in ("master", "mic", "clean", "hotkeys", "mp3") if self._exists(files[k])), None)
        self._rebuild_chapters()
        if pick is None:
            self._set_controls(False)
            self.wave.set_data(None, 0, [], [])
            self.note.set_text("This session has no audio yet.")
            return
        self.track = pick
        self._tracks[pick].set_active(True)
        self._load_track(pick, position=0.0)

    def _show_needs_recovery(self, status: str):
        """A session that can't be opened normally: say why, and offer the fix instead of a broken player."""
        self._loaded = None
        self.title.set_text(self.sel_path.name)
        self.meta.set_text("The app closed while this was recording." if status == "interrupted"
                           else "The session file is missing or damaged.")
        self.open_btn.set_label("Recover")
        self.open_btn.set_tooltip_text("Repair this session and open it")
        self.open_btn.set_sensitive(True)
        for btn in self._tracks.values():
            btn.set_sensitive(False)
        self._set_controls(False)
        self.wave.set_data(None, 0, [], [])
        self.player.stop()
        self._loaded_sig = None
        self.note.set_text("Recovery repairs the recording, restores your hotkey hits and settings where it can, and keeps "
                           "anything it replaces. Nothing is deleted.")
        self._rebuild_chapters()

    def _after_files_changed(self):
        """Files may have been re-rendered: update which stems exist and reload the current one if it changed."""
        files = self._files()
        for key, btn in self._tracks.items():
            btn.set_sensitive(bool(files) and self._exists(files[key]))
        if files and self._exists(files.get(self.track, Path("/nonexistent"))):
            f = files[self.track]
            sig = (str(f), f.stat().st_mtime_ns)
            if getattr(self, "_loaded_sig", None) != sig:
                self._load_track(self.track, position=self.player.position())
        self._rebuild_chapters()

    # ------------------------------------------------------------------ tracks and playback
    def _pick_track(self, key: str):
        if self._rebuilding or key == self.track and getattr(self, "_loaded_sig", None):
            self.track = key
            return
        self.track = key
        self._load_track(key, position=self.player.position())      # A/B: the same moment in the other stem

    def _load_track(self, key: str, position: float):
        f = self._files().get(key)
        if f is None or not self._exists(f):
            return
        was_playing = self.player.playing
        ok = self.player.load(f, position)
        if not ok:
            self.note.set_text(f"Couldn't open {f.name}.")
            self._set_controls(False)
            return
        self.player.set_volume(self.vol.get_value())
        self._loaded_sig = (str(f), f.stat().st_mtime_ns)
        self._set_controls(True)
        dur = self.player.duration() or (self.project.mic_duration if self.project else 0.0)
        self.wave.duration, self.wave.pos = dur, position
        self._refresh_markers()
        self._load_peaks(f, dur)
        kind = {"mic": "mono, 48 kHz, 24-bit", "clean": "mono, 48 kHz, 24-bit, noise reduced", "mp3": "stereo, 128 kbps"}.get(key, "stereo, 48 kHz, 24-bit")
        self.note.set_text(f"{f.name}  ·  {f.stat().st_size / 1e6:.1f} MB  ·  {kind}")
        self.play_btn.set_icon_name("media-playback-start-symbolic")
        if was_playing:
            self.player.play()
            self.play_btn.set_icon_name("media-playback-pause-symbolic")

    def _load_peaks(self, f: Path, dur: float):
        key = (str(f), f.stat().st_mtime_ns)
        if key in self._peaks_cache:
            self.wave.loading = False
            self.wave.set_data(self._peaks_cache[key], dur, self._hit_marks(), self._chapter_times())
            return
        self.wave.loading = True
        self.wave.set_data(None, dur, [], [])

        def work():
            try:
                peaks = audio.compute_peaks(f, 1600)
            except Exception:
                peaks = None
            GLib.idle_add(done, peaks)

        def done(peaks):
            if getattr(self, "_loaded_sig", None) == key:           # ignore results for a stale selection
                self._peaks_cache[key] = peaks
                self.wave.loading = False
                self.wave.set_data(peaks, dur, self._hit_marks(), self._chapter_times())
            return False

        threading.Thread(target=work, daemon=True).start()

    def _hit_marks(self):
        p = self.project
        if p is None:
            return []
        out = []
        for ev in p.events:
            color = p.pads[ev.pad].color if 0 <= ev.pad < len(p.pads) else "#a1a1aa"
            out.append((ev.t, color))
        return out

    def _chapter_times(self):
        return [c["t"] for c in (self.project.chapters if self.project else [])]

    def _refresh_markers(self):
        self.wave.hits, self.wave.chapter_times = self._hit_marks(), self._chapter_times()
        self.wave.queue_draw()

    def _set_controls(self, on: bool):
        for w in (self.play_btn, self.back_btn, self.fwd_btn, self.prev_hit, self.next_hit, self.add_ch_btn):
            w.set_sensitive(on)
        if not on:
            self.time_lbl.set_text("0:00 / 0:00")

    def toggle(self):
        if not self.player.path:
            return
        self.player.toggle()
        self.play_btn.set_icon_name("media-playback-pause-symbolic" if self.player.playing else "media-playback-start-symbolic")

    def pause(self):
        """Called when recording starts: preview audio must never leak into the mic."""
        if self.player.playing:
            self.player.pause()
            self.play_btn.set_icon_name("media-playback-start-symbolic")

    def _seek(self, t: float):
        self.player.seek(t)
        self._pending_seek = (t, time.monotonic())            # the player reports the old position for a moment
        self.wave.set_position(t)
        self._update_time(t)

    def _display_position(self) -> float:
        """Where the playhead should be drawn: the seek target until the player has actually arrived there."""
        pos = self.player.position()
        pending = getattr(self, "_pending_seek", None)
        if pending is not None:
            target, started = pending
            if abs(pos - target) < 0.5 or time.monotonic() - started > 1.0:
                self._pending_seek = None
            else:
                return target
        return pos

    def _nudge(self, dt: float):
        self._seek(self._display_position() + dt)

    def _jump_hit(self, direction: int):
        times = sorted(t for t, _ in self._hit_marks())
        pos = self._display_position()
        cands = [t for t in times if (t > pos + 0.3 if direction > 0 else t < pos - 0.3)]
        if cands:
            self._seek(min(cands) if direction > 0 else max(cands))

    def _on_eos(self):
        self.play_btn.set_icon_name("media-playback-start-symbolic")
        self.wave.set_position(0.0)
        self._update_time(0.0)

    def _update_time(self, pos: float):
        dur = self.wave.duration or self.player.duration() or 0.0
        self.time_lbl.set_text(f"{chap.fmt_time(pos)} / {chap.fmt_time(dur)}")

    def _tick(self):
        if self.get_mapped() and self.player.path:
            pos = self._display_position()
            self.wave.set_position(pos)
            self._update_time(pos)
        return True

    def on_key(self, name: str) -> bool:
        if not self.player.path:
            return False
        if name == "space":
            self.toggle()
        elif name == "Left":
            self._nudge(-SKIP_SECONDS)
        elif name == "Right":
            self._nudge(+SKIP_SECONDS)
        else:
            return False
        return True

    def shutdown(self):
        self.player.stop()

    # ------------------------------------------------------------------ chapters
    def add_chapter_here(self):
        p = self.project
        if p is None:
            return
        t = round(self.player.position(), 1)
        n = len(p.chapters) + 1
        p.chapters.append({"t": t, "title": "Intro" if n == 1 and t < 1 else f"Chapter {n}"})
        self._chapters_changed(focus_time=t)

    def _chapters_changed(self, focus_time: float | None = None):
        p = self.project
        p.chapters.sort(key=lambda c: c["t"])
        if p.created:
            p.save()
        self._rebuild_chapters(focus_time)
        self._refresh_markers()
        hook = getattr(self.win, "on_chapters_changed", None)
        if hook:
            hook()

    def _rebuild_chapters(self, focus_time: float | None = None):
        while (c := self.ch_list.get_first_child()) is not None:
            self.ch_list.remove(c)
        p = self.project
        if p is None:
            self.ch_hint.set_text("")
            return
        if not p.chapters:
            self.ch_hint.set_text("Play the recording and press “Add chapter here” where a new section starts. "
                                  "Chapters are uploaded with the episode and shown by podcast apps.")
        else:
            norm, notes = chap.normalize(p.chapters, p.mic_duration or None)
            self.ch_hint.set_text(" ".join(notes))
        for c in p.chapters:
            row = Gtk.Box(spacing=8)
            t_entry = Gtk.Entry(text=chap.fmt_time(c["t"], tenths=True), width_chars=9, max_width_chars=9)
            t_entry.add_css_class("mono")
            t_entry.set_tooltip_text("Start time (m:ss or h:mm:ss)")
            title = Gtk.Entry(text=c["title"], hexpand=True, placeholder_text="Chapter title")
            go = _icon_btn("media-playback-start-symbolic", "Play from here")
            rm = _icon_btn("user-trash-symbolic", "Delete this chapter")

            def commit_time(entry, ch=c):
                t = chap.parse_time(entry.get_text())
                if t is None:
                    entry.set_text(chap.fmt_time(ch["t"], tenths=True))
                    return
                if abs(t - ch["t"]) > 1e-6:
                    ch["t"] = t
                    self._chapters_changed()

            def commit_title(entry, ch=c):
                if entry.get_text() != ch["title"]:
                    ch["title"] = entry.get_text()
                    if self.project.created:
                        self.project.save()
                    hook = getattr(self.win, "on_chapters_changed", None)
                    if hook:
                        hook()

            for entry, fn in ((t_entry, commit_time), (title, commit_title)):
                entry.connect("activate", fn)
                fc = Gtk.EventControllerFocus()
                fc.connect("leave", lambda _c, e=entry, f=fn: f(e))
                entry.add_controller(fc)
            go.connect("clicked", lambda *_a, ch=c: (self._seek(ch["t"]), self.player.path and not self.player.playing and self.toggle()))
            rm.connect("clicked", lambda *_a, ch=c: (self.project.chapters.remove(ch), self._chapters_changed()))
            for w in (t_entry, title, go, rm):
                row.append(w)
            self.ch_list.append(row)
            if focus_time is not None and abs(c["t"] - focus_time) < 1e-6:
                GLib.idle_add(lambda e=title: (e.grab_focus(), e.select_region(0, -1), False)[2])

    # ------------------------------------------------------------------ actions
    def _open_selected(self):
        if not self.sel_path:
            return
        if self._status.get(self.sel_path, "ok") != "ok":
            self.win.recover_session(self.sel_path)
        else:
            self.win.activate_project(self.sel_path)

    def _show_folder(self):
        if self.sel_path:
            Gtk.FileLauncher.new(Gio.File.new_for_path(str(self.sel_path))).launch(self.win, None, None, None)
