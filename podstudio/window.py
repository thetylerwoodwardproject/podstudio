"""Main window: Session (strips + pads), Mic (PodMic DSP), Mix (master result)."""
from __future__ import annotations

import json
from importlib import resources
import shutil
import threading
import time
from pathlib import Path

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
gi.require_version("Graphene", "1.0")
gi.require_version("Gsk", "4.0")
from gi.repository import Adw, Gdk, Gio, GLib, Graphene, Gsk, Gtk, Pango  # noqa: E402

from . import audio, denoise, podmic, render  # noqa: E402
from . import recovery, runtime, updates  # noqa: E402
from .update_ui import UpdateDialog  # noqa: E402
from .publish_ui import ArtCard, PublishPanel  # noqa: E402
from .recordings_ui import RecordingsPage  # noqa: E402
from .script_ui import ScriptPage  # noqa: E402
from .project import DEFAULT_ROOT, PAD_COLORS, Event, Project, list_sessions  # noqa: E402

CONFIG = Path(GLib.get_user_config_dir()) / "podstudio" / "config.json"
UDEV_RULE = 'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="19f7", ATTRS{idProduct}=="004a", TAG+="uaccess"'
UDEV_CMD = (f"echo '{UDEV_RULE}' | sudo tee /etc/udev/rules.d/70-podstudio-podmic.rules >/dev/null && "
            "sudo udevadm control --reload && sudo udevadm trigger --subsystem-match=hidraw")


def load_config() -> dict:
    try:
        return json.loads(CONFIG.read_text())
    except Exception:
        return {}


def save_config(cfg: dict):
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    CONFIG.write_text(json.dumps(cfg, indent=2))


def fmt_db(v: float) -> str:
    return "−∞" if v <= -60 else f"{v:+.1f}"


def fmt_time(s: float) -> str:
    s = int(s)
    return f"{s // 3600:02d}:{(s // 60) % 60:02d}:{s % 60:02d}"


def ignore_scroll(scale: Gtk.Scale) -> Gtk.Scale:
    """Wheel and trackpad scrolling over a slider must not move it: faders get nudged by accident, and the
    Mic page sliders write to real hardware. Where the slider sits in a scrolled page, scroll that instead."""
    ctrl = Gtk.EventControllerScroll(flags=Gtk.EventControllerScrollFlags.BOTH_AXES)
    ctrl.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)

    def on_scroll(_c, _dx, dy):
        sw = scale.get_ancestor(Gtk.ScrolledWindow)
        if sw is not None:
            adj = sw.get_vadjustment()
            top = adj.get_upper() - adj.get_page_size()
            adj.set_value(min(max(adj.get_value() + dy * 48, adj.get_lower()), max(top, adj.get_lower())))
        return True

    ctrl.connect("scroll", on_scroll)
    scale.add_controller(ctrl)
    return scale


def human_duration(seconds: float) -> str:
    """5 seconds, 2 min 30 s, 1 h 05 min: for sentences, where 00:02:30 reads like a clock."""
    s = int(round(seconds))
    if s < 60:
        return f"{s} second{'s' if s != 1 else ''}"
    if s < 3600:
        return f"{s // 60} min {s % 60:02d} s"
    return f"{s // 3600} h {(s // 60) % 60:02d} min"


def make_label(text="", css=(), xalign=0.5, **kw) -> Gtk.Label:
    lb = Gtk.Label(label=text, xalign=xalign, **kw)
    for c in css:
        lb.add_css_class(c)
    return lb


class CheckRow(Gtk.Box):
    """One line of the 'Podcast standard' card: a status icon, a name and the measured value."""

    def __init__(self, title: str):
        super().__init__(spacing=12)
        self.icon = Gtk.Image(icon_name="content-loading-symbolic", valign=Gtk.Align.CENTER)
        col = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=1)
        col.append(make_label(title, ["param-name"], xalign=0))
        self.sub = make_label("Not mixed yet", ["mono", "param-val"], xalign=0)
        col.append(self.sub)
        self.append(self.icon)
        self.append(col)

    def set_subtitle(self, text: str):
        self.sub.set_text(text)


# ===================================================================== transfer-curve graph


class CurveGraph(Gtk.Widget):
    """Tiny live plot of a processor's input/output curve (dB in, dB out)."""

    __gtype_name__ = "PodStudioCurveGraph"

    def __init__(self, curve, color: str, marker=None, xr=(-60.0, 0.0), yr=(-60.0, 9.0)):
        super().__init__()
        self.curve, self.marker, self.xr, self.yr = curve, marker, xr, yr
        self.rgba = Gdk.RGBA()
        self.rgba.parse(color)
        self.set_size_request(-1, 118)
        self.set_hexpand(True)

    def _stroke(self, snap, pts, width, color):
        pb = Gsk.PathBuilder.new()
        pb.move_to(*pts[0])
        for x, y in pts[1:]:
            pb.line_to(x, y)
        snap.append_stroke(pb.to_path(), Gsk.Stroke.new(width), color)

    def do_snapshot(self, snap):
        w, h = self.get_width(), self.get_height()
        (x0, x1), (y0, y1) = self.xr, self.yr
        X = lambda v: (v - x0) / (x1 - x0) * w
        Y = lambda v: h - (min(max(v, y0), y1) - y0) / (y1 - y0) * h
        grid = Gdk.RGBA(); grid.parse("rgba(255,255,255,0.06)")
        dim = Gdk.RGBA(); dim.parse("rgba(255,255,255,0.22)")
        for g in range(-48, 1, 12):
            snap.append_color(grid, Graphene.Rect().init(X(g), 0, 1, h))
        for g in range(-48, 1, 12):
            snap.append_color(grid, Graphene.Rect().init(0, Y(g), w, 1))
        self._stroke(snap, [(X(x0), Y(x0)), (X(x1), Y(x1))], 1.0, dim)            # 1:1 reference
        if self.marker:
            m = self.marker()
            if m is not None:
                snap.append_color(dim, Graphene.Rect().init(X(m), 0, 1, h))
        xs = [x0 + i * (x1 - x0) / 120 for i in range(121)]
        self._stroke(snap, [(X(x), Y(self.curve(x))) for x in xs], 2.2, self.rgba)


# ===================================================================== channel strip

DB_TICKS = (0, -6, -12, -24, -36, -48)
CHANNEL_COLORS = {"mic": "#3ddc97", "hk": "#ffb454", "master": "#6ea8ff"}
METER_H, METER_BLOCKS = 224, 32


class Strip(Gtk.Box):
    """Colour-coded console channel: name tag, dB readout, dBFS ruler + LED meter, fader, mute."""

    def __init__(self, title: str, lo: float, hi: float, value: float, on_change, *, channel="mic", step=0.5,
                 marks=(0,), fmt=fmt_db, unit="dB", meter=True, tooltip="", unity_label="Unity"):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        self.add_css_class("strip")
        self.add_css_class(f"ch-{channel}")
        self.fmt, self.on_change, self._clip_until = fmt, on_change, 0.0
        self.unity = marks[0] if marks else 0.0          # first mark is the reference point (0 dB / target)
        self._peak, self._peak_until = -90.0, 0.0
        self.peak_text = None                              # set by the master strip: live LUFS / dBFS readout
        self.set_hexpand(True)
        if tooltip:
            self.set_tooltip_text(tooltip)

        name = Gtk.Box(spacing=7, halign=Gtk.Align.CENTER)
        dot = Gtk.Box(valign=Gtk.Align.CENTER)
        dot.add_css_class("ch-dot")
        name.append(dot)
        name.append(make_label(title, ["strip-name"]))
        self.append(name)
        self.readout = make_label("", ["readout", "mono"])
        self.append(self.readout)
        self.append(make_label(unit, ["unit"]))

        body = Gtk.Box(spacing=6, halign=Gtk.Align.CENTER, vexpand=True)
        # dBFS ruler: labels live in an overlay (overlays add no minimum height), placed from the meter's real height
        self.ruler = Gtk.Overlay()
        spacer = Gtk.Box(vexpand=True)
        spacer.set_size_request(30, 60)
        self.ruler.set_child(spacer)
        self._ticks = []
        for db in DB_TICKS:
            lb = make_label(f"{db}", ["dbfs"], xalign=1, valign=Gtk.Align.START, halign=Gtk.Align.END)
            self.ruler.add_overlay(lb)
            self._ticks.append((db, lb))
        self._ruler_h = -1
        self.ruler.add_tick_callback(self._layout_ruler)
        self.ruler.set_visible(meter)
        body.append(self.ruler)

        self.meter = Gtk.LevelBar(orientation=Gtk.Orientation.VERTICAL, mode=Gtk.LevelBarMode.DISCRETE,
                                  min_value=0, max_value=METER_BLOCKS, inverted=True)
        self.meter.add_css_class("meter")
        for off in (Gtk.LEVEL_BAR_OFFSET_LOW, Gtk.LEVEL_BAR_OFFSET_HIGH, Gtk.LEVEL_BAR_OFFSET_FULL):
            self.meter.remove_offset_value(off)
        self.meter.add_offset_value("low", 0.78 * METER_BLOCKS)
        self.meter.add_offset_value("high", 0.93 * METER_BLOCKS)
        self.meter.add_offset_value("full", METER_BLOCKS)
        self.meter.set_visible(meter)
        self.meter.set_size_request(14, METER_H)
        body.append(self.meter)

        self.fader = Gtk.Scale.new_with_range(Gtk.Orientation.VERTICAL, lo, hi, step)
        self.fader.add_css_class("fader")
        self.fader.set_inverted(True)
        self.fader.set_draw_value(False)
        ignore_scroll(self.fader)
        self.fader.set_size_request(52, METER_H)
        self.fader.set_vexpand(True)
        col = CHANNEL_COLORS.get(channel, "#e8ecf2")
        for i, m in enumerate(marks):
            label = (f"<span foreground='{col}' weight='bold'>{m:g} · {unity_label}</span>" if i == 0
                     else f"<span foreground='#6b7686'>{m:g}</span>")
            self.fader.add_mark(m, Gtk.PositionType.RIGHT, label)
        self.fader.set_value(value)
        self.fader.connect("value-changed", self._changed)
        click = Gtk.GestureClick()          # double-click resets to unity / target
        click.connect("pressed", lambda g, n, x, y: n == 2 and self.fader.set_value(marks[0] if marks else 0))
        self.fader.add_controller(click)
        body.append(self.fader)
        self.append(body)

        self.peak_label = make_label("", ["peak", "mono"])
        self.peak_label.set_visible(meter)
        self.append(self.peak_label)
        self.mute = Gtk.ToggleButton(label="Mute", halign=Gtk.Align.CENTER)
        self.mute.add_css_class("mute-btn")
        self.append(self.mute)
        self.footer = Gtk.Box(halign=Gtk.Align.CENTER, spacing=6)
        self.append(self.footer)
        self._changed(self.fader)
        self._show_peak()

    def _layout_ruler(self, widget, _clock):
        h = widget.get_height()
        if h > 0 and h != self._ruler_h:
            self._ruler_h = h
            usable = h - 6                                   # LED trough has ~3 px padding at each end
            for db, lb in self._ticks:
                lb.set_margin_top(max(0, int(3 + (1 - (db + 60) / 60) * usable - 5)))
        return GLib.SOURCE_CONTINUE

    def _changed(self, scale):
        v = scale.get_value()
        if v != self.unity and abs(v - self.unity) < 0.4:      # magnetic detent at unity
            scale.set_value(self.unity)
            return
        at_unity = abs(v - self.unity) < 0.05
        (self.readout.add_css_class if at_unity else self.readout.remove_css_class)("unity")
        self.readout.set_text(self.fmt(v))
        self.on_change(v)

    def _show_peak(self):
        if self.peak_text is not None:
            self.peak_label.set_text(self.peak_text)
            return
        self.peak_label.set_text("Peak  —" if self._peak <= -60 else f"Peak {self._peak:5.1f} dBFS")

    def set_level(self, peak_db: float):
        self.meter.set_value(audio.meter_fraction(peak_db) * METER_BLOCKS)
        now = time.monotonic()
        if peak_db >= self._peak or now > self._peak_until:   # hold the peak for 1.5 s, then follow the signal
            self._peak, self._peak_until = peak_db, now + 1.5
            self._show_peak()
        if peak_db > -1.0:
            self._clip_until = now + 1.5
        if now < self._clip_until:
            self.readout.add_css_class("clip")
            self.peak_label.add_css_class("clip")
        else:
            self.readout.remove_css_class("clip")
            self.peak_label.remove_css_class("clip")


# ===================================================================== pad


class PadWidget(Gtk.Overlay):
    def __init__(self, win: "PodStudioWindow", index: int):
        super().__init__()
        self.win, self.index = win, index
        self.add_css_class("pad-wrap")
        self.btn = Gtk.Button()
        self.btn.add_css_class("pad")
        self.btn.add_css_class(f"pad-{index}")
        # press and release are separate so "Hold" pads work with the mouse as well as the keyboard
        press = Gtk.GestureClick(button=1)
        press.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
        press.connect("pressed", lambda *_: win.pad_press(index))
        press.connect("released", lambda *_: win.pad_release(index))
        press.connect("cancel", lambda *_: win.pad_release(index))
        self.btn.add_controller(press)
        inner = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2, margin_top=10, margin_bottom=10,
                        margin_start=12, margin_end=12)
        self.key = make_label("", ["keycap"], halign=Gtk.Align.START)
        self.label = make_label("", ["pad-label"], xalign=0, halign=Gtk.Align.START, vexpand=True,
                                valign=Gtk.Align.END)
        self.clip = make_label("", ["pad-clip"], xalign=0, halign=Gtk.Align.START, ellipsize=Pango.EllipsizeMode.END, max_width_chars=14)
        keyrow = Gtk.Box(spacing=6)
        self.mode_badge = make_label("", ["pill"], halign=Gtk.Align.END, hexpand=True)
        self.duck_badge = make_label("Duck", ["pill"], halign=Gtk.Align.END)
        self.duck_badge.set_tooltip_text("Ducks under your voice")
        keyrow.append(self.key)
        keyrow.append(self.mode_badge)
        keyrow.append(self.duck_badge)
        for w in (keyrow, self.label, self.clip):
            inner.append(w)
        self.btn.set_child(inner)
        self.set_child(self.btn)

        self.edit = Gtk.MenuButton(icon_name="document-edit-symbolic", halign=Gtk.Align.END, valign=Gtk.Align.START,
                                   margin_top=6, margin_end=6, tooltip_text="Edit pad")
        self.edit.add_css_class("pad-edit")
        self.edit.add_css_class("flat")
        self.add_overlay(self.edit)
        self.pop = Gtk.Popover()
        self.edit.set_popover(self.pop)
        self.pop.connect("show", self._build_editor)
        kc = Gtk.EventControllerKey()
        kc.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
        kc.connect("key-pressed", lambda c, kv, code, st: win.capture_key(kv))
        self.pop.add_controller(kc)
        self.refresh()

    @property
    def pad(self):
        return self.win.project.pads[self.index]

    def refresh(self):
        p = self.pad
        self.key.set_text(p.key.upper() or "–")
        self.duck_badge.set_visible(p.duck)
        names = {"momentary": "Hold", "toggle": "Toggle", "loop": "Loop"}
        self.mode_badge.set_text(names.get(p.mode, ""))
        self.mode_badge.set_visible(p.mode in names)
        self.label.set_text(p.label or ("Empty" if not p.clip else Path(p.clip).stem))
        self.clip.set_text(p.clip if p.clip else "Click ✎ to add a sound")
        if p.clip:
            self.btn.remove_css_class("empty")
        else:
            self.btn.add_css_class("empty")

    def set_playing(self, on: bool):
        if on != self.btn.has_css_class("playing"):
            (self.btn.add_css_class if on else self.btn.remove_css_class)("playing")

    def flash(self):
        self.btn.add_css_class("hit")
        GLib.timeout_add(140, lambda: (self.btn.remove_css_class("hit"), False)[1])

    # -- editor popover
    def _build_editor(self, *_):
        p = self.pad
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10, margin_top=12, margin_bottom=12,
                      margin_start=12, margin_end=12)
        box.set_size_request(300, -1)
        name = Gtk.Entry(text=p.label, placeholder_text="Pad name")
        name.connect("changed", lambda e: (setattr(self.pad, "label", e.get_text()), self.refresh(),
                                           self.win.project.save()))
        box.append(name)

        row = Gtk.Box(spacing=8)
        self.keybtn = Gtk.Button(label=f"Key: {p.key.upper() or '–'}")
        self.keybtn.connect("clicked", self._capture_key)
        sound = Gtk.Button(label="Choose sound…", hexpand=True)
        sound.connect("clicked", lambda *_: self.win.choose_clip(self.index))
        row.append(self.keybtn)
        row.append(sound)
        box.append(row)

        box.append(make_label("Button mode", ["param-name"], xalign=0))
        mr = Gtk.Box(css_classes=["linked", "seg"])
        first = None
        for key, label, tip in (("once", "One-shot", "Plays once each time you press it"),
                                ("momentary", "Hold", "Plays only while the key or pad is held down"),
                                ("toggle", "Toggle", "Press to start, press again to stop"),
                                ("loop", "Loop", "Repeats seamlessly until you press it again")):
            b = Gtk.ToggleButton(label=label, active=(p.mode == key), tooltip_text=tip)
            b.add_css_class("chip-btn")
            if first is None:
                first = b
            else:
                b.set_group(first)
            b.connect("toggled", lambda t, k=key: t.get_active() and self._set_mode(k))
            mr.append(b)
        box.append(mr)

        box.append(make_label("Level", ["vd-title"], xalign=0))
        g = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, -24, 12, 0.5)
        ignore_scroll(g)
        g.set_value(p.gain_db)
        g.add_mark(0, Gtk.PositionType.BOTTOM, "0 dB")
        g.connect("value-changed", lambda s: (setattr(self.pad, "gain_db", s.get_value()), self.win.project.save()))
        box.append(g)

        dr = Gtk.Box(spacing=8)
        dr.append(make_label("Duck under my voice", ["param-name"], xalign=0, hexpand=True))
        duck_sw = Gtk.Switch(active=p.duck, valign=Gtk.Align.CENTER)
        duck_sw.connect("notify::active", lambda s_, _p: (setattr(self.pad, "duck", s_.get_active()), self.refresh(),
                                                          self.win.project.save()))
        dr.append(duck_sw)
        box.append(dr)

        sw = Gtk.Box(spacing=6, halign=Gtk.Align.CENTER)
        first = None
        for c in PAD_COLORS:
            b = Gtk.ToggleButton()
            b.add_css_class("swatch")
            b.set_active(c == p.color)
            if first:
                b.set_group(first)
            first = first or b
            css = Gtk.CssProvider()
            css.load_from_string(f"button {{ background: {c}; }}")
            b.get_style_context().add_provider(css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
            b.connect("toggled", lambda t, col=c: t.get_active() and self.win.set_pad_color(self.index, col))
            sw.append(b)
        box.append(sw)

        clear = Gtk.Button(label="Clear pad")
        clear.add_css_class("destructive-action")
        clear.connect("clicked", lambda *_: (self.win.clear_pad(self.index), self.pop.popdown()))
        box.append(clear)
        self.pop.set_child(box)

    def _set_mode(self, mode: str):
        self.pad.mode = mode
        self.pad.loop = mode == "loop"
        self.refresh()
        self.win.project.save()

    def _capture_key(self, *_):
        self.keybtn.set_label("Press a key…")
        self.win.capture_for = self.index


# ===================================================================== window


def tab_icon(name: str) -> Gtk.Image:
    """Thin line icons for the tab bar (bundled symbolic SVGs, recoloured by the theme like any other icon)."""
    theme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default())
    path = str(resources.files("podstudio").joinpath("data/icons-theme"))
    if path not in (theme.get_search_path() or []):
        theme.add_search_path(path)
    img = Gtk.Image.new_from_icon_name(f"ps-tab-{name}-symbolic")
    img.set_pixel_size(22)
    return img


class PodStudioWindow(Adw.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app, title="PodStudio", default_width=1120, default_height=720)
        self.add_css_class("podstudio")
        self.cfg = load_config()
        self.project: Project | None = None
        self.source: str | None = None
        self.capture_for: int | None = None
        self.player = audio.ClipPlayer(on_level=self._on_clip_level)
        self._held: set[int] = set()              # pads whose key is physically down (ignores auto-repeat)
        self._open_events: dict[int, Event] = {}  # held / toggled / looped hits that haven't ended yet
        self._clip_level_t = 0.0
        self._journal: recovery.Journal | None = None       # hotkey hits, written as they happen so a crash loses none
        self.engine = audio.MicEngine(on_level=self._on_level, on_error=self._on_audio_error, on_voice=self._on_voice)
        self._duck_db = 0.0
        self.hk_level = -90.0
        self.mic_level = -90.0
        self.rec_started = 0.0
        self.mix_busy = False
        self._pad_css = Gtk.CssProvider()
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), self._pad_css,
                                                  Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1)

        last = self.cfg.get("last_project")
        try:
            self.project = Project.load(Path(last)) if last else None
        except Exception:
            self.project = None
        if self.project is None:
            self.project = self._blank_project()

        self._build()
        self._refresh_source()
        self._apply_pad_css()
        self._show_mix_stats()
        GLib.timeout_add(100, self._tick)
        GLib.timeout_add(2000, self._poll_mic)
        self._poll_mic()
        self.connect("close-request", self._on_close)
        GLib.timeout_add(700, self._check_recovery)         # after the window is up
        GLib.timeout_add_seconds(8, self._auto_check_updates)

        key = Gtk.EventControllerKey()
        key.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
        key.connect("key-pressed", self._on_key)
        key.connect("key-released", self._on_key_released)
        self.add_controller(key)

    # ------------------------------------------------------------------ project helpers
    def _blank_project(self) -> Project:
        p = Project(name="", root=DEFAULT_ROOT)
        from .project import DEFAULT_KEYS, Pad
        p.pads = [Pad(key=k, color=PAD_COLORS[i % len(PAD_COLORS)]) for i, k in enumerate(DEFAULT_KEYS[:8])]
        return p

    def _materialize(self):
        """Give an unsaved scratch project a real folder the first time it's needed."""
        if self.project.created:
            return
        fresh = Project.create(time.strftime("Session %Y-%m-%d %H-%M"))
        fresh.pads = self.project.pads
        fresh.carry_over(self.project)
        fresh.mic_db, fresh.hotkeys_db, fresh.target_lufs = (self.project.mic_db, self.project.hotkeys_db,
                                                             self.project.target_lufs)
        self.project = fresh
        fresh.save()
        self._remember()

    def _fork_for_take(self):
        """A recording is never overwritten: a new take is a new project with the same pads."""
        old = self.project
        new = Project.create(time.strftime("Session %Y-%m-%d %H-%M"))
        new.pads = [type(p)(**vars(p)) for p in old.pads]
        new.carry_over(old)
        new.mic_db, new.hotkeys_db, new.target_lufs = old.mic_db, old.hotkeys_db, old.target_lufs
        new.ensure_dirs()
        for p in new.pads:
            if p.clip and (old.clips_dir / p.clip).exists():
                shutil.copy2(old.clips_dir / p.clip, new.clips_dir / p.clip)
        new.save()
        self.script.adopt(new.root)                   # the new take starts with the same script
        self.project = new
        self._remember()

    def _remember(self):
        self.cfg["last_project"] = str(self.project.root)
        save_config(self.cfg)
        self.title_label.set_text(self.project.name or "New session")

    # ------------------------------------------------------------------ UI build
    def _build(self):
        self.toasts = Adw.ToastOverlay()
        tv = Adw.ToolbarView()
        header = Adw.HeaderBar()

        # record button + timecode
        self.rec_btn = Gtk.Button()
        self.rec_btn.add_css_class("rec-btn")
        rb = Gtk.Box(spacing=8)
        rb.append(Gtk.Box(css_classes=["rec-dot"], valign=Gtk.Align.CENTER))
        self.rec_label = Gtk.Label(label="Record")
        rb.append(self.rec_label)
        self.rec_btn.set_child(rb)
        self.rec_btn.set_tooltip_text("Record (Ctrl+R)")
        self.rec_btn.connect("clicked", lambda *_: self.toggle_record())
        logo = Gtk.Box(halign=Gtk.Align.CENTER, valign=Gtk.Align.CENTER, css_classes=["logo-tile"])
        logo.append(Gtk.Box(css_classes=["logo-dot"], halign=Gtk.Align.CENTER, valign=Gtk.Align.CENTER, hexpand=True, vexpand=True))
        brand = Gtk.Box(spacing=12, margin_end=14)
        brand.append(logo)
        brand.append(make_label("PodStudio", ["brand"]))
        header.pack_start(brand)
        self.rec_btn.set_valign(Gtk.Align.CENTER)
        header.pack_start(self.rec_btn)
        self.mic_pill = make_label("", ["pill"], margin_end=8)

        self.stack = Adw.ViewStack()
        tabs = self._tab_bar()
        tabs.set_margin_start(12)
        tabs.set_valign(Gtk.Align.CENTER)
        header.pack_start(tabs)
        header.set_title_widget(Gtk.Box())

        menu = Gio.Menu()
        menu.append("New Session", "win.new")
        menu.append("Open Session…", "win.open")
        menu.append("Show Session Folder", "win.folder")
        if runtime.updates_enabled():                       # Flatpak is updated by its own store
            upd = Gio.Menu()
            upd.append("Check for Updates…", "win.check-updates")
            upd.append("Check automatically", "win.auto-updates")
            menu.append_section(None, upd)
        about = Gio.Menu()
        about.append("About PodStudio", "app.about")
        menu.append_section(None, about)
        mb = Gtk.MenuButton(icon_name="open-menu-symbolic", menu_model=menu)
        header.pack_end(mb)
        self.title_label = make_label(self.project.name or "New session", ["session-name"], ellipsize=Pango.EllipsizeMode.END, width_chars=16, max_width_chars=26)
        session_box = Gtk.Box(spacing=10, margin_end=8, valign=Gtk.Align.CENTER, css_classes=["session-pill"])
        session_box.append(self.title_label)
        session_box.append(Gtk.Image.new_from_icon_name("pan-down-symbolic"))
        header.pack_end(session_box)
        header.pack_end(self.mic_pill)
        self.update_btn = Gtk.Button(label="Update available", visible=False, valign=Gtk.Align.CENTER,
                                     tooltip_text="A newer version of PodStudio is available")
        self.update_btn.add_css_class("update-pill")
        self.update_btn.connect("clicked", lambda *_: self.show_update_dialog())
        header.pack_end(self.update_btn)
        check = Gio.SimpleAction.new("check-updates", None)
        check.connect("activate", lambda *_: self.check_updates(manual=True))
        self.add_action(check)
        auto = Gio.SimpleAction.new_stateful("auto-updates", None, GLib.Variant.new_boolean(self.cfg.get("auto_update_check", True)))
        auto.connect("change-state", self._on_auto_updates)
        self.add_action(auto)
        for name, cb in (("new", self.new_session), ("open", self.open_session), ("folder", self.open_folder)):
            act = Gio.SimpleAction.new(name, None)
            act.connect("activate", lambda *_a, cb=cb: cb())
            self.add_action(act)

        self.stack.add_titled_with_icon(self._session_page(), "session", "Session", "media-record-symbolic")
        self.stack.add_titled_with_icon(self._mic_page(), "mic", "Mic", "audio-input-microphone-symbolic")
        self.script = ScriptPage(self)
        self.stack.add_titled_with_icon(self.script, "script", "Script", "document-edit-symbolic")
        self.stack.add_titled_with_icon(self._mix_page(), "mix", "Mix", "multimedia-equalizer-symbolic")
        self.recordings = RecordingsPage(self)
        self.stack.add_titled_with_icon(self.recordings, "recordings", "Recordings", "folder-music-symbolic")
        self.stack.add_titled_with_icon(self._publish_page(), "publish", "Publish", "mail-send-symbolic")
        self.stack.connect("notify::visible-child-name", self._on_tab)
        self._sync_tab_bar()
        tv.add_top_bar(header)
        tv.set_content(self.stack)
        self.toasts.set_child(tv)
        self.set_content(self.toasts)

    TABS = (("session", "Session", ""), ("mic", "Mic", ""), ("mix", "Mix", ""), ("recordings", "Recordings", ""),
            ("script", "Script", ""), ("publish", "Publish", ""))

    def _tab_bar(self):
        """Icon-only page switcher. The names live in tooltips and in the accessible labels."""
        bar = Gtk.Box(css_classes=["tab-bar"], valign=Gtk.Align.CENTER)
        self._tab_buttons, first = {}, None
        self._tab_labels = []
        for name, label, icon in self.TABS:
            b = Gtk.ToggleButton(tooltip_text=label, css_classes=["tab-btn"])
            inner = Gtk.Box(spacing=7)
            inner.append(tab_icon(name))
            lab = Gtk.Label(label=label)
            inner.append(lab)
            b.set_child(inner)
            self._tab_labels.append(lab)
            b.update_property([Gtk.AccessibleProperty.LABEL], [label])
            if first:
                b.set_group(first)
            first = first or b
            b.connect("toggled", lambda btn, n=name: btn.get_active() and self.stack.set_visible_child_name(n))
            self._tab_buttons[name] = b
            bar.append(b)
        self.stack.connect("notify::visible-child-name", self._sync_tab_bar)
        self.add_tick_callback(self._tab_text_for_width)
        return bar

    def _tab_text_for_width(self, *_):
        """Same rule as the Windows app: icons only, with tooltips, until the window is wide enough for labels."""
        wide = self.get_width() >= 1300
        for lab in self._tab_labels:
            if lab.get_visible() != wide:
                lab.set_visible(wide)
        return GLib.SOURCE_CONTINUE

    def _sync_tab_bar(self, *_):
        b = self._tab_buttons.get(self.stack.get_visible_child_name())
        if b and not b.get_active():
            b.set_active(True)

    # ---- Session page: fader bank on the left, display + pads on the right
    def _session_page(self) -> Gtk.Widget:
        page = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14, margin_top=16, margin_bottom=16, margin_start=16, margin_end=16)
        page.add_css_class("vd-page")
        top_row = Gtk.Box(spacing=14, vexpand=True)

        pr = self.project
        bank = Gtk.Box(spacing=0)
        bank.add_css_class("console")
        self.mic_strip = Strip("Mic", -60, 12, pr.mic_db, self._set_mic_db, channel="mic", marks=(0, 6, -6, -12, -24, -48),
                               tooltip="Mic level: moves the meter now and sets the mic-vs-hotkeys balance in the master. "
                                       "The master is normalized to the loudness target and the mic stem is always recorded clean.")
        self.hk_strip = Strip("Hotkeys", -60, 12, pr.hotkeys_db, self._set_hk_db, channel="hk", marks=(0, 6, -6, -12, -24, -48),
                              tooltip="Hotkey volume: live playback and master mix.")
        self.master_strip = Strip("Master", -30, -6, pr.target_lufs, self._set_target, channel="master", marks=(-16, -12, -20, -24), unity_label="Target",
                                  fmt=lambda v: f"{v:.1f}", unit="LUFS target", meter=True,
                                  tooltip="Fader: the integrated loudness the master is normalized to.\n"
                                          "Meter: live momentary loudness. Click it to switch between LUFS (loudness) and dBFS (peak).")
        self.master_mode = self.cfg.get("master_meter", "lufs")
        self.master_strip.peak_text = "Loudness  —"
        for w in (self.master_strip.meter, self.master_strip.ruler, self.master_strip.peak_label):
            g = Gtk.GestureClick()
            g.connect("pressed", lambda *_: self._toggle_master_mode())
            w.add_controller(g)
            w.set_cursor_from_name("pointer")
        self.mute_btn = self.mic_strip.mute                      # hardware mute (needs mic control)
        self.mute_btn.connect("toggled", self._on_mute_toggled)
        self.hk_strip.mute.set_active(pr.hotkeys_muted)
        self.hk_strip.mute.connect("toggled", self._on_hk_mute)
        self.duck_label = make_label("", ["peak"])
        self.hk_strip.footer.append(self.duck_label)
        self.master_strip.mute.set_visible(False)
        self.mix_btn = Gtk.Button(label="Mix")
        self.mix_btn.add_css_class("mix-btn")
        self.mix_btn.connect("clicked", lambda *_: self.mix_now())
        self.master_strip.footer.append(self.mix_btn)
        for i, st in enumerate((self.mic_strip, self.hk_strip, self.master_strip)):
            if i:
                bank.append(Gtk.Separator(orientation=Gtk.Orientation.VERTICAL))
            bank.append(st)
        console = self._head_card("Console")
        console.append(make_label("Levels in dBFS. Double-click a fader for unity (0 dB).", ["vd-sub"], xalign=0))
        bank.set_vexpand(True)
        console.append(bank)
        top_row.append(console)

        # recorder card: state, big time, big record button, last master loudness
        rec = self._head_card("Recorder")
        rec.set_size_request(380, -1)
        rec.set_hexpand(False)
        self.state_label = make_label("Ready", ["disp-state"], xalign=0)
        self.timecode = make_label("00:00:00", ["timecode", "mono"], halign=Gtk.Align.CENTER)
        self.source_label = make_label("", ["disp-sub"], halign=Gtk.Align.CENTER)
        rec.append(self.state_label)
        mid = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14, vexpand=True, valign=Gtk.Align.CENTER)
        mid.append(self.timecode)
        self.big_rec = Gtk.Button(halign=Gtk.Align.CENTER, tooltip_text="Record (Ctrl+R)")
        self.big_rec.add_css_class("big-rec")
        self.big_rec.set_child(Gtk.Box(css_classes=["big-rec-dot"]))
        self.big_rec.connect("clicked", lambda *_: self.toggle_record())
        mid.append(self.big_rec)
        self.big_rec_label = make_label("Record  (Ctrl+R)", ["disp-sub"], halign=Gtk.Align.CENTER)
        mid.append(self.big_rec_label)
        mid.append(self.source_label)
        rec.append(mid)
        stats = Gtk.Box(spacing=8, halign=Gtk.Align.CENTER)
        self.disp_lufs = make_label("—", ["disp-lufs-s", "mono"])
        stats.append(make_label("Last master", ["disp-sub"]))
        stats.append(self.disp_lufs)
        stats.append(make_label("LUFS", ["disp-sub"]))
        rec.append(stats)
        top_row.append(rec)
        page.append(top_row)

        # hotkeys card, full width underneath
        stop_btn = Gtk.Button(label="Stop sounds")
        stop_btn.add_css_class("chip-btn")
        stop_btn.connect("clicked", lambda *_: self.player.stop_all())
        hot = self._head_card("Hotkeys", stop_btn)
        self.hint = make_label("Press a pad's key or click it. Right-click a pad to edit it. Hits are saved on their own track.",
                               ["vd-sub"], xalign=0, wrap=True)
        hot.append(self.hint)
        self.grid = Gtk.Grid(row_spacing=10, column_spacing=10, column_homogeneous=True, row_homogeneous=True)
        self.pads: list[PadWidget] = []
        self._fill_pads()
        hot.append(self.grid)
        page.append(hot)
        self._session_inner = page
        self._gate = self._build_mic_gate()
        shell = Gtk.Overlay()
        shell.set_child(page)
        shell.add_overlay(self._gate)
        return shell

    def _build_mic_gate(self) -> Gtk.Widget:
        """Covers the Session page until the PodMic is connected. It swallows every click, and it goes away by itself."""
        gate = Gtk.Box(hexpand=True, vexpand=True, halign=Gtk.Align.FILL, valign=Gtk.Align.FILL)
        gate.add_css_class("mic-gate")
        card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12, halign=Gtk.Align.CENTER,
                       valign=Gtk.Align.CENTER, hexpand=True, vexpand=True)
        card.add_css_class("mic-gate-card")
        icon = Gtk.Image(icon_name="audio-input-microphone-symbolic", pixel_size=54, halign=Gtk.Align.CENTER)
        icon.add_css_class("mic-gate-icon")
        card.append(icon)
        card.append(make_label("Connect your PodMic USB", ["vd-h1"]))
        body = make_label("PodStudio works with the RØDE PodMic USB only. Plug it into a USB port and this "
                          "screen clears by itself.", ["vd-sub"], wrap=True, max_width_chars=46)
        body.set_justify(Gtk.Justification.CENTER)
        card.append(body)
        wait = Gtk.Box(spacing=8, halign=Gtk.Align.CENTER, margin_top=6)
        wait.append(Gtk.Spinner(spinning=True))
        wait.append(make_label("Waiting for the PodMic…", ["vd-sub"]))
        card.append(wait)
        tip = make_label("Not showing up? Try another USB port or cable. The other tabs work without it.",
                         ["vd-sub"], wrap=True, max_width_chars=50, margin_top=4)
        tip.set_justify(Gtk.Justification.CENTER)
        card.append(tip)
        gate.append(card)
        return gate

    def _gated(self) -> bool:
        gate = getattr(self, "_gate", None)
        return gate is not None and gate.get_visible()

    def _update_gate(self):
        """Show the connect screen while there is no PodMic. A take that is already running is never covered."""
        if not hasattr(self, "_gate"):
            return
        gated = not self.source and not self.engine.recording
        self._gate.set_visible(gated)
        self._session_inner.set_sensitive(not gated)

    def _fill_pads(self):
        while (c := self.grid.get_first_child()):
            self.grid.remove(c)
        self.pads = []
        for i in range(len(self.project.pads)):
            w = PadWidget(self, i)
            self.pads.append(w)
            self.grid.attach(w, i % 4, i // 4, 1, 1)

    # ---- Mic page: PodMic input, headphones and on-board processing, laid out as cards
    def _card(self, title: str, css: str = "") -> Gtk.Box:
        card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10, hexpand=True)
        for c in ("vd-panel", "card-pad", css):
            if c:
                card.add_css_class(c)
        card.append(make_label(title, ["card-title"], xalign=0))
        return card

    def _make_scale(self, key, lo, hi, step, value, fmt, apply, *, hid=True, basic=False, redraw=None):
        scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, lo, hi, step)
        scale.add_css_class("param")
        ignore_scroll(scale)
        scale.set_draw_value(False)
        scale.set_hexpand(True)
        scale.set_value(value)
        val = make_label(fmt(value), ["mono", "param-val"], xalign=1, width_chars=9)

        def changed(sc):
            v = sc.get_value()
            val.set_text(fmt(v))
            if redraw:
                redraw()
            if self._syncing:
                return
            if basic:
                self._debounce("basic", self._apply_basic_now)
            else:
                self._debounce(key, lambda: self._guard(lambda: apply(v), hid))

        scale.connect("value-changed", changed)
        self.dsp_rows[key] = scale
        return scale, val

    def _row(self, label: str, scale, val) -> Gtk.Box:
        row = Gtk.Box(spacing=10)
        row.append(make_label(label, ["param-name"], xalign=0, width_chars=11))
        row.append(scale)
        row.append(val)
        return row

    def _chip(self, key, label, apply, hid=True) -> Gtk.ToggleButton:
        btn = Gtk.ToggleButton(label=label)
        btn.add_css_class("chip-btn")
        if key != "mute":                      # red means muted; every other "on" is green
            btn.add_css_class("chip-ok")

        def toggled(b):
            if not self._syncing:
                self._guard(lambda: apply(b.get_active()), hid)

        btn.connect("toggled", toggled)
        self.dsp_rows[key] = btn
        return btn

    def _mic_page(self) -> Gtk.Widget:
        scroller = Gtk.ScrolledWindow(hscrollbar_policy=Gtk.PolicyType.NEVER, vexpand=True)
        scroller.add_css_class("vd-page")
        clamp = Adw.Clamp(maximum_size=940, margin_top=16, margin_bottom=24, margin_start=16, margin_end=16)
        self.dsp_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14)
        clamp.set_child(self.dsp_box)
        scroller.set_child(clamp)

        self.dsp_banner = Adw.Banner(title="", revealed=False)
        self.dsp_banner.connect("button-clicked", self._copy_udev)
        self.dsp_box.append(self.dsp_banner)

        self.mic: podmic.PodMic | None = None
        self.dsp_state = None
        self._dsp_timers: dict[str, int] = {}
        self._syncing = False
        self.dsp_rows: dict[str, Gtk.Widget] = {}
        self.fx_enable: dict[str, Gtk.ToggleButton] = {}

        top = Gtk.Box(spacing=14, homogeneous=True)
        self.dsp_box.append(top)

        # -- input
        inp = self._card("Input", "ch-mic")
        gain_row = Gtk.Box(spacing=10)
        self.gain_big = make_label("—", ["big-number", "mono"], xalign=0, hexpand=True)
        gain_row.append(self.gain_big)
        gain_row.append(make_label("Gain", ["stat-label"], valign=Gtk.Align.END, margin_bottom=8))
        inp.append(gain_row)
        gscale, gval = self._make_scale("gain", 22, 63, 0.5, 57, lambda v: f"{v:.1f} dB",
                                        lambda v: podmic.set_gain_db(v), hid=False)
        gscale.connect("value-changed", lambda sc: self.gain_big.set_text(f"{sc.get_value():.1f} dB"))
        self.gain_big.set_text("57.0 dB")
        inp.append(gscale)
        self.in_meter = Gtk.LevelBar(min_value=0, max_value=40, mode=Gtk.LevelBarMode.DISCRETE)
        self.in_meter.add_css_class("meter")
        self.in_meter.add_css_class("hmeter")
        for off in (Gtk.LEVEL_BAR_OFFSET_LOW, Gtk.LEVEL_BAR_OFFSET_HIGH, Gtk.LEVEL_BAR_OFFSET_FULL):
            self.in_meter.remove_offset_value(off)
        self.in_meter.add_offset_value("low", 0.78 * 40)
        self.in_meter.add_offset_value("high", 0.93 * 40)
        self.in_meter.add_offset_value("full", 40)
        inp.append(self.in_meter)
        chips = Gtk.Box(spacing=8)
        chips.append(self._chip("mute", "Mute", lambda on: self.mic.set_mute(on)))
        chips.append(self._chip("hpf", "High-pass", lambda on: self.mic.set_hpf(on)))
        inp.append(chips)
        inp.append(make_label("Mute is not remembered when the mic is unplugged. High-pass cuts below about 54 Hz.",
                              ["vd-sub"], xalign=0, wrap=True))
        self.dsp_rows["mute"].connect("notify::active", lambda r, _p: self.mute_btn.set_active(r.get_active()))
        top.append(inp)

        # -- headphones
        ph = self._card("Headphones", "ch-hk")
        ph.append(make_label("Monitor mix", ["stat-label"], xalign=0))
        mscale, mval = self._make_scale("monitor_mix", 0, 100, 1, 91, lambda v: f"{v * 66 / 100 - 60:+.0f} dB",
                                        lambda v: self.mic.set_monitor_mix(int(v)))
        ph.append(self._row("Mic level", mscale, mval))
        mon = self._chip("monitoring", "Direct monitoring", lambda on: self.mic.set_monitoring(on))
        mon.set_halign(Gtk.Align.START)
        ph.append(mon)
        ph.append(make_label("Direct monitoring plays your mic in the headphone jack with no delay. "
                             "It is independent of mute.", ["vd-sub"], xalign=0, wrap=True))
        top.append(ph)

        # -- processing header
        head = Gtk.Box(spacing=12, margin_top=6)
        head.append(make_label("Processing", ["vd-title"], xalign=0, hexpand=True))
        head.append(make_label("Runs inside the mic, so every app hears it.", ["vd-sub"]))
        head.append(self._chip("processing", "On", lambda on: self.mic.set_processing(on)))
        seg = Gtk.Box(css_classes=["linked", "seg"])
        basic_btn = Gtk.ToggleButton(label="Basic", active=True)
        adv_btn = Gtk.ToggleButton(label="Advanced", group=basic_btn)
        for b in (basic_btn, adv_btn):
            b.add_css_class("chip-btn")
            seg.append(b)
        adv_btn.connect("toggled", lambda b: (not self._syncing) and self._guard(lambda: self._set_advanced(b.get_active())))
        self.dsp_rows["advanced"] = adv_btn
        self._basic_btn = basic_btn
        head.append(seg)
        self.dsp_box.append(head)

        # -- basic: three big cards
        self.basic_box = Gtk.Box(spacing=14, homogeneous=True)
        for key, title, sub, css in (("depth", "Depth", "Low-end weight (Big Bottom)", "fx-bottom"),
                                     ("sparkle", "Sparkle", "Air and presence (Aural Exciter)", "fx-exciter"),
                                     ("punch", "Punch", "Dynamics (compressor and gate)", "fx-comp")):
            c = self._card(title, css)
            sc, val = self._make_scale(key, 0, 100, 1, 50, lambda v: f"{v:.0f}", lambda v: None, basic=True)
            val.remove_css_class("param-val")
            val.add_css_class("big-number")
            val.set_xalign(0)
            c.append(val)
            c.append(sc)
            c.append(make_label(sub, ["vd-sub"], xalign=0))
            self.basic_box.append(c)
        self.dsp_box.append(self.basic_box)

        # -- advanced: four processor cards
        self.adv_box = Gtk.Grid(row_spacing=14, column_spacing=14, column_homogeneous=True)
        self.dsp_box.append(self.adv_box)
        val = lambda k: self.dsp_rows[k].get_value()
        comp_curve = lambda x: ((x if x <= val("comp.threshold") else val("comp.threshold") + (x - val("comp.threshold")) / max(val("comp.ratio"), 1.0))
                                + val("comp.gain"))
        gate_curve = lambda x: x if x >= val("gate.threshold") else x + val("gate.range")
        spec = [
            ("comp", "Compressor", "fx-comp", "#ffb454", 0, 0,
             [("threshold", "Threshold", -60, 0, 0.5, "{:.1f} dB"), ("ratio", "Ratio", 1.5, 4.5, 0.05, "{:.2f} : 1"),
              ("attack", "Attack", 0.1, 10, 0.1, "{:.1f} ms"), ("release", "Release", 5, 200, 1, "{:.0f} ms"),
              ("gain", "Make-up gain", 0, 9, 0.1, "{:.1f} dB")], comp_curve, lambda: val("comp.threshold")),
            ("gate", "Noise gate", "fx-gate", "#4fd8eb", 0, 1,
             [("threshold", "Threshold", -60, 0, 0.5, "{:.1f} dB"), ("range", "Range", -100, 0, 1, "{:.0f} dB"),
              ("attack", "Attack", 0.1, 1000, 1, "{:.0f} ms"), ("hold", "Hold", 0.05, 2, 0.01, "{:.2f} s"),
              ("release", "Release", 0.05, 2, 0.01, "{:.2f} s"), ("hysteresis", "Hysteresis", 0, 100, 1, "{:.0f} %")],
             gate_curve, lambda: val("gate.threshold")),
            ("exciter", "Aural Exciter", "fx-exciter", "#b48bff", 1, 0,
             [("harmonics", "Harmonics", 0, 100, 1, "{:.0f} %"), ("tune", "Tune", 600, 5000, 10, "{:.0f} Hz")], None, None),
            ("bottom", "Big Bottom", "fx-bottom", "#ff7ad9", 1, 1,
             [("drive", "Drive", 0, 100, 1, "{:.0f} %"), ("tune", "Tune", 60, 312, 1, "{:.0f} Hz")], None, None),
        ]
        for block, title, css, color, row, col, fields, curve, marker in spec:
            card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10, vexpand=True)
            for c in ("vd-panel", "card-pad", css):
                card.add_css_class(c)
            hd = Gtk.Box(spacing=8)
            hd.append(make_label(title, ["card-title"], xalign=0, hexpand=True))
            en = self._chip(f"{block}_on", "On", lambda on, b=block: self.mic.set_enabled(b, on))
            self.fx_enable[block] = en
            hd.append(en)
            card.append(hd)
            graph = None
            if curve:
                graph = CurveGraph(curve, color, marker=marker)
                frame = Gtk.Box(css_classes=["curve-frame"])
                frame.append(graph)
                card.append(frame)
            for field, ftitle, lo, hi, step, fmt in fields:
                sc, v = self._make_scale(f"{block}.{field}", lo, hi, step, podmic.DEFAULTS[(block, field)],
                                         lambda x, f=fmt: f.format(x),
                                         lambda x, b=block, f=field: self.mic.set_field(b, f, x),
                                         redraw=(graph.queue_draw if graph else None))
                card.append(self._row(ftitle, sc, v))
            self.adv_box.attach(card, col, row, 1, 1)

        self._update_mode_visibility(False)
        self._set_dsp_sensitive(False)
        return scroller

    def _debounce(self, key, fn, ms=120):
        if key in self._dsp_timers:
            GLib.source_remove(self._dsp_timers[key])

        def run():
            self._dsp_timers.pop(key, None)
            fn()
            return False

        self._dsp_timers[key] = GLib.timeout_add(ms, run)

    def _guard(self, fn, hid=True):
        if hid and self.dsp_state != "ok":
            return
        try:
            fn()
        except podmic.PodMicError as e:
            self.toast(f"Mic control: {e}")

    def _apply_basic_now(self):
        vals = [self.dsp_rows[k].get_value() for k in ("depth", "sparkle", "punch")]
        self._guard(lambda: self.mic.apply_basic(*vals))

    def _set_advanced(self, on: bool):
        self.mic.set_advanced(on)
        self._update_mode_visibility(on)

    def _update_mode_visibility(self, advanced: bool):
        self.basic_box.set_visible(not advanced)
        self.adv_box.set_visible(advanced)

    def _set_dsp_sensitive(self, on: bool):
        for k, w in self.dsp_rows.items():
            if k != "gain":
                w.set_sensitive(on)
        self._basic_btn.set_sensitive(on)

    def _copy_udev(self, *_):
        self.get_clipboard().set(UDEV_CMD)
        self.toast("Command copied. Paste it into a terminal and run it.")

    def _poll_mic(self):
        self._refresh_source()
        present = podmic.PodMic.present()
        if not present:
            self._dsp_set_state("absent")
        elif self.dsp_state != "ok":
            try:
                m = podmic.PodMic()
                m.open()
                self.mic = m
                self._dsp_set_state("ok")
                self._sync_from_mic()
            except podmic.PodMicAccessDenied:
                self._dsp_set_state("denied")
            except podmic.PodMicError:
                self._dsp_set_state("absent")
        have_mic = present or getattr(self, "source", None) is not None
        if have_mic:                                      # gain goes through the system mixer, so it needs no HID access
            g = podmic.get_gain_db()
            if g is not None and "gain" not in self._dsp_timers:
                self._syncing = True
                self.dsp_rows["gain"].set_value(g)
                self._syncing = False
        self.dsp_rows["gain"].set_sensitive(have_mic and podmic.gain_supported())
        return True

    def _dsp_set_state(self, state):
        if state == self.dsp_state:
            return
        if self.dsp_state == "ok" and self.mic:
            self.mic.close()
            self.mic = None
        self.dsp_state = state
        self._set_dsp_sensitive(state == "ok")
        b = self.dsp_banner
        if state == "denied":
            b.set_title("Mic control needs a one-time permission. Copy the setup command and run it in a terminal "
                        "(replug the mic if this message stays).")
            b.set_button_label("Copy command")
            b.set_revealed(True)
        elif state == "absent":
            if runtime.IS_WINDOWS and getattr(self, "source", None):
                b.set_title("The mic is connected, but its on-board controls didn't answer. Close any other app that "
                            "controls it (RØDE Central), then unplug and replug the mic.")
            else:
                b.set_title("PodMic USB not detected. Plug it in to control its on-board processing.")
            b.set_button_label("")
            b.set_revealed(True)
        else:
            b.set_revealed(False)

    def _sync_from_mic(self):
        """Pull current values from the mic so the controls mirror the hardware."""
        self._syncing = True
        try:
            st = self.mic.read_state()
            for key in ("hpf", "mute", "monitoring", "processing", "advanced"):
                if st.get(key) is not None:
                    self.dsp_rows[key].set_active(bool(st[key]))
            if st.get("advanced") is not None and not st["advanced"]:
                self._basic_btn.set_active(True)
            if st.get("monitor_mix") is not None:
                self.dsp_rows["monitor_mix"].set_value(st["monitor_mix"])
            for key in ("depth", "sparkle", "punch"):
                if st.get(key) is not None:
                    self.dsp_rows[key].set_value(st[key])
            for block, chip in self.fx_enable.items():
                if st.get(f"{block}_on") is not None:
                    chip.set_active(bool(st[f"{block}_on"]))
            for key, w in self.dsp_rows.items():
                if "." in key:
                    b, f = key.split(".")
                    v = self.mic.read_field(b, f)
                    if v is not None:
                        w.set_value(v)
            self._update_mode_visibility(bool(st.get("advanced")))
            self.mute_btn.set_active(bool(st.get("mute")))
        finally:
            self._syncing = False

    # ---- Mix page
    def _head_card(self, title: str, trailing=None, css: str = "") -> Gtk.Box:
        card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12, hexpand=True)
        for c in ("vd-panel", "card-pad", css):
            if c:
                card.add_css_class(c)
        head = Gtk.Box(spacing=8)
        head.append(make_label(title, ["card-title"], xalign=0, hexpand=True))
        if trailing is not None:
            head.append(trailing)
        card.append(head)
        return card

    def _page_scroller(self, width: int):
        scroller = Gtk.ScrolledWindow(hscrollbar_policy=Gtk.PolicyType.NEVER, vexpand=True)
        scroller.add_css_class("vd-page")
        clamp = Adw.Clamp(maximum_size=width, margin_top=16, margin_bottom=24, margin_start=16, margin_end=16)
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14)
        clamp.set_child(box)
        scroller.set_child(clamp)
        return scroller, box

    # ---- Mix page: the master, what goes into it, and the export
    def _mix_page(self) -> Gtk.Widget:
        scroller, box = self._page_scroller(980)
        self._mix_syncing = False

        # master result
        self.render_btn = Gtk.Button(label="Render master", valign=Gtk.Align.CENTER, tooltip_text="Mix, clean up and normalize")
        self.render_btn.add_css_class("mix-btn")
        self.render_btn.connect("clicked", lambda *_: self.mix_now())
        master = self._head_card("Master", self.render_btn)
        stats = Gtk.Box(homogeneous=True)
        self.stat = {}
        for key, title in (("before", "Measured"), ("after", "Master"), ("gain", "Gain applied"), ("tp", "True peak · dBTP")):
            c = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4, margin_top=6, margin_bottom=6)
            lb = make_label("—", ["big-number", "mono"])
            c.append(lb)
            c.append(make_label(title, ["stat-label"]))
            stats.append(c)
            self.stat[key] = lb
        master.append(stats)
        self.mix_status = make_label("Record a take, then render the master. Everything below is applied when you render.",
                                     ["vd-sub"], xalign=0, wrap=True)
        master.append(self.mix_status)
        box.append(master)

        cols = Gtk.Box(spacing=14, homogeneous=True, valign=Gtk.Align.START)
        left = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14)
        right = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14)
        cols.append(left)
        cols.append(right)
        box.append(cols)

        # noise reduction
        self.denoise_chip = Gtk.ToggleButton(label="Off")
        self.denoise_chip.add_css_class("chip-btn")
        self.denoise_chip.add_css_class("chip-ok")
        def denoise_toggled(b):
            b.set_label("On" if b.get_active() else "Off")
            self._mix_setting("denoise", b.get_active())
        self.denoise_chip.connect("toggled", denoise_toggled)
        clean = self._head_card("Noise reduction", self.denoise_chip)
        self.denoise_note = make_label("", ["vd-sub"], xalign=0, wrap=True)
        clean.append(self.denoise_note)
        self.strength_scale, sval = self._mix_scale("denoise_atten_db", denoise.ATTEN_MIN, denoise.ATTEN_MAX, 1,
                                                    lambda v: f"{v:.0f} dB")
        clean.append(self._row("Strength", self.strength_scale, sval))
        clean.append(make_label("Lower keeps more of the room sound. Your raw mic stem is never modified.", ["vd-sub"],
                                xalign=0, wrap=True))
        left.append(clean)

        # ducking
        duck = self._head_card("Ducking")
        duck.append(make_label("Pads with Duck switched on (use the pencil on a pad) dip while you speak. "
                               "Other pads play at full level.", ["vd-sub"], xalign=0, wrap=True))
        self.duck_scales = []
        for attr, label, lo, hi, step, fmt in (("duck_amount_db", "Amount", 3, 30, 1, lambda v: f"−{v:.0f} dB"),
                                               ("duck_threshold_db", "Sensitivity", -60, -20, 1, lambda v: f"{v:.0f} dBFS"),
                                               ("duck_release_ms", "Release", 50, 1500, 10, lambda v: f"{v:.0f} ms")):
            sc, val = self._mix_scale(attr, lo, hi, step, fmt)
            self.duck_scales.append(sc)
            duck.append(self._row(label, sc, val))
        left.append(duck)

        # podcast standard
        spec = self._head_card("Podcast standard")
        spec.append(make_label("Stereo, −16 LUFS integrated, true peak at or below −1 dBTP.", ["vd-sub"], xalign=0, wrap=True))
        self.spec_rows = {}
        for key, title in (("lufs", "Loudness"), ("tp", "True peak"), ("fmt", "Format")):
            row = CheckRow(title)
            spec.append(row)
            self.spec_rows[key] = (row, row.icon)
        right.append(spec)

        # export
        self.export_btn = Gtk.Button(label="Export MP3", valign=Gtk.Align.CENTER,
                                     tooltip_text="Encode the master to a 128 kbps MP3 and verify it")
        self.export_btn.add_css_class("mix-btn")
        self.export_btn.connect("clicked", lambda *_: self.export_mp3())
        export = self._head_card("Export", self.export_btn)
        self.mp3_status = make_label("", ["vd-sub"], xalign=0, wrap=True)
        export.append(self.mp3_status)
        links = Gtk.Box(spacing=8)
        for label, tab in (("Listen in Recordings", "recordings"), ("Publish to Buzzsprout", "publish")):
            b = Gtk.Button(label=label)
            b.add_css_class("chip-btn")
            b.connect("clicked", lambda _b, t=tab: self.stack.set_visible_child_name(t))
            links.append(b)
        export.append(links)
        right.append(export)

        self._sync_mix_settings()
        self._update_export_card()
        return scroller

    # ---- Publish page: episode audio, art, then the Buzzsprout form
    def _publish_page(self) -> Gtk.Widget:
        scroller, box = self._page_scroller(760)
        self.pub_preview_btn = Gtk.Button(label="Listen", valign=Gtk.Align.CENTER, tooltip_text="Play the MP3 in Recordings")
        self.pub_preview_btn.add_css_class("chip-btn")
        self.pub_preview_btn.connect("clicked", lambda *_: self._preview_mp3())
        audio_card = self._head_card("Episode audio", self.pub_preview_btn)
        self.pub_audio = make_label("", ["vd-sub"], xalign=0, wrap=True)
        audio_card.append(self.pub_audio)
        box.append(audio_card)
        self.art_card = ArtCard(self)
        box.append(self.art_card)
        self.publish = PublishPanel(self)
        box.append(self.publish.group)
        self._update_publish_audio()
        return scroller

    def _preview_mp3(self):
        self.stack.set_visible_child_name("recordings")
        self.recordings._tracks["mp3"].set_active(True)

    def _mix_scale(self, attr, lo, hi, step, fmt):
        scale = ignore_scroll(Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, lo, hi, step))
        scale.set_draw_value(False)
        scale.set_hexpand(True)
        scale.add_css_class("param")
        val = make_label("", ["mono", "param-val"], width_chars=9, xalign=1)
        scale._attr, scale._val, scale._fmt = attr, val, fmt

        def changed(sc):
            sc._val.set_text(sc._fmt(sc.get_value()))
            self._mix_setting(attr, float(sc.get_value()))

        scale.connect("value-changed", changed)
        return scale, val

    def _mix_setting(self, attr, value):
        if self._mix_syncing:
            return
        setattr(self.project, attr, value)
        if self.project.created:
            self.project.save()

    def _sync_mix_settings(self):
        """Show the current project's cleanup and ducking settings without writing them back."""
        pr, have = self.project, denoise.available()
        self._mix_syncing = True
        try:
            self.denoise_chip.set_sensitive(have)
            self.denoise_chip.set_active(pr.denoise and have)
            self.denoise_chip.set_label("On" if self.denoise_chip.get_active() else "Off")
            self.denoise_note.set_text("DeepFilterNet removes steady background noise when the master is rendered." if have else
                                       "DeepFilterNet isn't installed. The packaged builds include it.")
            for sc in [self.strength_scale] + self.duck_scales:
                sc.set_value(getattr(pr, sc._attr))
                sc._val.set_text(sc._fmt(sc.get_value()))
            self.strength_scale.set_sensitive(have)
        finally:
            self._mix_syncing = False

    def _refresh_files(self):
        """Something on disk changed (render, export, new take): refresh every view of it."""
        if hasattr(self, "recordings"):
            self.recordings.refresh()
        if hasattr(self, "mp3_status"):
            self._update_export_card()
        if hasattr(self, "pub_audio"):
            self._update_publish_audio()

    def _mp3_summary(self) -> str:
        f = self.project.mp3_path
        if not (f.exists() and f.stat().st_size > 44):
            return ""
        note = getattr(self, "mp3_note", "")
        return f"{f.name}  ·  {f.stat().st_size / 1e6:.1f} MB  ·  stereo, 128 kbps" + (f"  ·  {note}" if note else "")

    def _update_export_card(self):
        s = self._mp3_summary()
        self.mp3_status.set_text(s or "Not exported yet. This encodes the master to a 128 kbps MP3 and checks the result "
                                      "against the podcast spec.")

    def _update_publish_audio(self):
        s = self._mp3_summary()
        self.pub_audio.set_text(s or "The MP3 is encoded for you when you upload, or export it first on the Mix tab.")
        self.pub_preview_btn.set_sensitive(bool(s))

    def _on_tab(self, *_):
        tab = self.stack.get_visible_child_name()
        if tab == "recordings":
            self.recordings.refresh()
        elif tab == "publish":
            self._update_publish_audio()
            self.art_card.sync()
            self.publish.sync_chapters()
        if tab != "recordings":
            self.recordings.pause()

    def on_chapters_changed(self):
        if hasattr(self, "publish"):
            self.publish.sync_chapters()

    # ---- updates
    def _on_auto_updates(self, action, value):
        action.set_state(value)
        self.cfg["auto_update_check"] = value.get_boolean()
        self.save_cfg()

    def _auto_check_updates(self):
        if runtime.updates_enabled() and self.cfg.get("auto_update_check", True) and updates.should_check(self.cfg.get("last_update_check", 0)):
            self.check_updates(manual=False)
        return False

    def check_updates(self, manual: bool):
        """Look for a newer release off the UI thread. Automatic checks stay quiet unless there is something to say."""
        if not runtime.updates_enabled():
            return
        def work():
            try:
                return updates.check(), None
            except updates.UpdateError as e:
                return None, str(e)

        def done(result):
            info, err = result
            if err:
                if manual:
                    self.toast(f"Couldn't check for updates. {err}")
                return False
            self.cfg["last_update_check"] = time.time()
            self.save_cfg()
            self._update_info = info
            self.update_btn.set_visible(info is not None)
            if info is None:
                if manual:
                    self.toast(f"You're up to date (v{updates.current_version()}).")
            elif manual:
                self.show_update_dialog()
            else:
                self.toast(f"PodStudio v{info.version} is available.")
            return False

        threading.Thread(target=lambda: GLib.idle_add(done, work()), daemon=True).start()

    def show_update_dialog(self):
        info = getattr(self, "_update_info", None)
        if info is not None:
            UpdateDialog(self, info).present(self)

    # ---- recovery: after a crash, a power cut or a damaged session file
    def _check_recovery(self):
        """At launch: if a recording was cut short, offer to bring it back."""
        sessions = list_sessions(DEFAULT_ROOT)
        stuck = [x for x in sessions if x["status"] == "interrupted"]
        if not stuck:
            damaged = [x for x in sessions if x["status"] == "damaged"]
            if damaged:
                self.toast(f"{len(damaged)} session{'s' if len(damaged) != 1 else ''} can be recovered. Open the Recordings tab.")
            return False
        x = stuck[0]
        mins = f"about {human_duration(x['duration'])}" if x["duration"] else "some"
        more = f" There are {len(stuck) - 1} more on the Recordings tab." if len(stuck) > 1 else ""
        d = Adw.AlertDialog(
            heading="Recover your last recording?",
            body=f"PodStudio closed unexpectedly while recording “{x['name']}”. {mins[0].upper() + mins[1:]} of audio was saved to disk, "
                 f"along with your hotkey hits.{more}")
        d.add_response("later", "Not now")
        d.add_response("recover", "Recover")
        d.set_response_appearance("recover", Adw.ResponseAppearance.SUGGESTED)
        d.set_default_response("recover")
        d.set_close_response("later")
        d.connect("response", lambda _d, r: r == "recover" and self.recover_session(x["path"]))
        d.present(self)
        return False

    def recover_session(self, path):
        """Repair a session folder in place, open it, and say what was done."""
        if self.engine.recording:
            self.toast("Stop recording first.")
            return
        try:
            rec = recovery.recover(Path(path))
        except recovery.RecoveryError as e:
            self.toast(str(e))
            return
        except Exception as e:                                # never leave the user with a silent failure
            self.toast(f"Recovery failed: {e}")
            return
        self.activate_project(path)
        self.toast(" ".join(rec.notes) or "That session is fine. Nothing needed recovering.")
        if rec.project.has_recording() and not rec.project.master_path.exists():
            self.mix_now()                                    # the master was never made

    def recover_folder(self):
        dlg = Gtk.FileDialog(title="Recover a session folder")
        dlg.set_initial_folder(Gio.File.new_for_path(str(DEFAULT_ROOT if DEFAULT_ROOT.exists() else Path.home())))

        def done(d, res):
            try:
                gf = d.select_folder_finish(res)
            except GLib.Error:
                return
            self.recover_session(gf.get_path())

        dlg.select_folder(self, None, done)

    def activate_project(self, path):
        """Make a session the active one (used by the Recordings tab and Open Session)."""
        if self.engine.recording:
            self.toast("Stop recording first.")
            return
        try:
            self.project = Project.load(Path(path))
        except Exception as e:
            self.toast(f"Couldn't open that session: {e}")
            return
        self._remember()
        self._reload_project_ui()

    # ------------------------------------------------------------------ mixer callbacks
    def _set_mic_db(self, v):
        if self.project:
            self.project.mic_db = v
        self.engine.set_gain_db(v)

    def _set_hk_db(self, v):
        if self.project:
            self.project.hotkeys_db = v
        self.player.set_master_db(v)                # playing clips follow the fader immediately

    def _set_target(self, v):
        if self.project:
            self.project.target_lufs = v

    def _on_hk_mute(self, btn):
        self.project.hotkeys_muted = btn.get_active()
        if btn.get_active():
            self.player.stop_all()
        if self.project.created:
            self.project.save()

    def _on_mute_toggled(self, btn):
        if self._syncing:
            return
        if self.dsp_state == "ok":
            self.dsp_rows["mute"].set_active(btn.get_active())
        else:
            self.toast("Mute needs mic control. See the Mic tab.")
            self._syncing = True
            btn.set_active(False)
            self._syncing = False

    # ------------------------------------------------------------------ input source / metering
    def _refresh_source(self):
        """PodStudio only works with the RØDE PodMic USB: find it, follow it being plugged and unplugged."""
        present = podmic.PodMic.present()
        src = audio.find_podmic_source() if (present or runtime.IS_WINDOWS) else None
        first = not getattr(self, "_source_checked", False)       # the very first look must always set the labels,
        self._source_checked = True                               # even when "no mic" is also what we started with
        if src == self.source and not first:
            return
        self.source = src
        self._update_source_label()
        if not self.engine.recording:
            if src:
                self.engine.start_meter(src)
            else:
                self.engine.stop()
                self.mic_strip.set_level(-90.0)
                self.in_meter.set_value(0)
        self.rec_btn.set_sensitive(bool(src) or self.engine.recording)
        if hasattr(self, "big_rec"):
            self.big_rec.set_sensitive(bool(src) or self.engine.recording)
        getattr(self, "_update_armed", lambda: None)()
        self._update_gate()

    def _update_source_label(self):
        ok = bool(self.source)
        self.source_label.set_text("RØDE PodMic USB  ·  48 kHz  ·  24-bit" if ok else "PodMic USB not connected")
        self.mic_pill.set_text("PodMic USB connected" if ok else "PodMic USB not connected")
        (self.mic_pill.add_css_class if ok else self.mic_pill.remove_css_class)("ok")
        (self.mic_pill.remove_css_class if ok else self.mic_pill.add_css_class)("warn")
        if not self.engine.recording:
            self.state_label.set_text("Ready" if ok else "Plug in your PodMic USB")

    def _on_clip_level(self, peak_db: float):
        """Real level of whatever the hotkeys are playing, after the fader and ducking."""
        self.hk_level = peak_db
        self._clip_level_t = time.monotonic()

    def _on_voice(self, rms_db):
        """Live ducking: follow the mic's pre-fader level with the same attack/release the render uses."""
        pr = self.project
        target = -pr.duck_amount_db if rms_db > pr.duck_threshold_db else 0.0
        tau = render.DUCK_ATTACK_MS if target < self._duck_db else pr.duck_release_ms
        self._duck_db += (target - self._duck_db) * (1 - 2.718281828 ** (-50.0 / max(tau, 1.0)))   # 50 ms between messages
        if abs(self._duck_db) < 0.05:
            self._duck_db = 0.0
        self.player.set_duck_db(self._duck_db)
        self.duck_label.set_text(f"Ducking {self._duck_db:.1f} dB" if self._duck_db <= -0.5 else "")

    def _toggle_master_mode(self):
        self.master_mode = "dbfs" if self.master_mode == "lufs" else "lufs"
        try:
            self.cfg["master_meter"] = self.master_mode
            save_config(self.cfg)
        except Exception:
            pass
        self._update_master_meter()

    def _update_master_meter(self):
        """Master meter: momentary LUFS (K-weighted, mic ×2 + hotkeys, as the render mixes them) or the mixed peak."""
        mic_ms, hk_ms = self.engine.k_ms, self.player.k_ms()
        have_k = mic_ms is not None
        if self.master_mode == "lufs" and have_k:
            live = self.engine.recording or self.source
            v = audio.lufs_from_ms(2 * mic_ms + hk_ms) if live else -90.0
            self.master_strip.set_level(v)
            self.master_strip.peak_text = "Loudness  —" if v <= -60 else f"{v:5.1f} LUFS  (m)"
        else:
            v = max(self.mic_level + self.project.mic_db, self.hk_level)
            self.master_strip.set_level(v)
            self.master_strip.peak_text = None
        self.master_strip._show_peak()

    def _on_level(self, rms, peak):
        self.mic_level = peak
        self.mic_strip.set_level(peak)
        self.in_meter.set_value(audio.meter_fraction(peak) * 40)

    def _on_audio_error(self, msg, was_recording=False):
        self._set_recording_ui(False)
        if not was_recording:
            self.toast(f"Audio error: {msg}")
            return
        # The mic went away mid-take (unplugged, USB reset). The WAV never got its final header: repair it and keep the take.
        try:
            self.project.mic_duration = audio.repair_wav_header(self.project.mic_path)
        except Exception:
            self.project.mic_duration = 0.0
        self.project.recording = False
        self.project.save()
        self._discard_journal()
        self._refresh_files()
        self.toast(f"The PodMic disconnected. Kept {fmt_time(self.project.mic_duration)} of the take.")
        self._refresh_source()
        if self.project.mic_duration > 0:
            self.mix_now()

    def _tick(self):
        if self.engine.recording:
            pos = self.engine.position() or 0.0
            self.timecode.set_text(fmt_time(pos))
            self.rec_label.set_text(f"Stop  {fmt_time(pos)}")
        if time.monotonic() - self._clip_level_t > 0.15:        # nothing reporting: let the peak fall away
            self.hk_level -= 4.0
        self.hk_strip.set_level(self.hk_level)
        self._update_master_meter()
        for i, w in enumerate(self.pads):
            w.set_playing(self.player.is_active(i))
        return True

    # ------------------------------------------------------------------ recording
    def toggle_record(self):
        if self.engine.recording:
            self.rec_btn.set_sensitive(False)
            self._close_open_events(self.engine.position())
            self.engine.stop_recording(self._after_stop)
            return
        if not self.source:
            self.toast("Plug in your PodMic USB to record.")
            return
        if self.project.created and self.project.has_recording():
            self._fork_for_take()
            self._fill_pads()
            self._refresh_files()
        else:
            self._materialize()
        self.recordings.pause()                      # never let preview audio reach the mic
        self.project.ensure_dirs()
        self.project.events = []
        self.project.recording = True                   # still True after a crash: that is how it is noticed next launch
        self.project.save()
        self._journal = recovery.Journal(self.project.journal_path)
        self._journal.start()
        self.engine.start_recording(self.source, self.project.mic_path)
        self._set_recording_ui(True)
        self.timecode.set_text("00:00:00")

    def _set_recording_ui(self, rec: bool):
        for w in (self.rec_btn,):
            (w.add_css_class if rec else w.remove_css_class)("recording")
        (self.big_rec.add_css_class if rec else self.big_rec.remove_css_class)("recording")
        self.big_rec_label.set_text("Stop  (Ctrl+R)" if rec else "Record  (Ctrl+R)")
        (self.timecode.add_css_class if rec else self.timecode.remove_css_class)("live")
        self.rec_label.set_text("Stop  00:00:00" if rec else "Record")
        self._update_armed()
        self.state_label.set_text("Recording" if rec else "Ready")
        (self.state_label.add_css_class if rec else self.state_label.remove_css_class)("live")
        self.rec_btn.set_sensitive(bool(self.source) or rec)
        self._update_gate()
        if getattr(self, "script", None):
            self.script.recording_changed(rec)

    def _update_armed(self):
        """Ready to record (PodMic present, not recording) is shown in the header on every tab."""
        armed = bool(self.source) and not self.engine.recording
        (self.rec_btn.add_css_class if armed else self.rec_btn.remove_css_class)("armed")
        self.rec_btn.set_tooltip_text("Stop recording (Ctrl+R)" if self.engine.recording else
                                      "Armed: PodMic ready. Record (Ctrl+R)" if armed else "Plug in the PodMic USB to record")

    def _after_stop(self):
        import soundfile as sf
        self._set_recording_ui(False)
        self.player.stop_all()
        self.project.recording = False
        try:
            self.project.mic_duration = sf.info(str(self.project.mic_path)).duration
        except Exception:
            self.project.mic_duration = 0.0
        self.project.save()
        self._discard_journal()                              # only now: its hits are safely in project.json
        self.engine.start_meter(self.source)
        self._refresh_files()
        self.toast(f"Saved {fmt_time(self.project.mic_duration)} take. Mixing master…")
        self.mix_now()

    # ------------------------------------------------------------------ mixing
    def mix_now(self):
        if self.mix_busy:
            return
        p = self.project
        if not p.created or not p.has_recording():
            self.toast("Nothing to mix yet. Record a take first.")
            return
        self.mix_busy = True
        self.mix_btn.set_sensitive(False)
        self.render_btn.set_sensitive(False)
        self.mix_status.set_text("Mixing…")
        p.save()

        def work():
            try:
                res = render.mix_master(p, progress=lambda m: GLib.idle_add(self.mix_status.set_text, m + "…"))
                GLib.idle_add(self._mix_done, res, None)
            except Exception as e:  # surfaced in the UI, never silent
                GLib.idle_add(self._mix_done, None, str(e))

        threading.Thread(target=work, daemon=True).start()

    def _mix_done(self, res, err):
        self.mix_busy = False
        self.mix_btn.set_sensitive(True)
        self.render_btn.set_sensitive(True)
        if err:
            self.mix_status.set_text(f"Mix failed: {err}")
            self.toast("Mix failed. See the Mix tab.")
            return
        self.project.mix_stats = {"before": res.measured_lufs, "after": res.final_lufs, "gain": res.gain_db,
                                  "tp": res.true_peak_db, "limited": res.limited}
        self.project.save()
        self._show_mix_stats()
        extra = " A peak limiter kept it under −1 dBFS." if res.limited else ""
        extra += (" Noise reduction applied." if res.denoised else "") + (" Ducking applied." if res.ducked else "")
        extra += "".join(" " + n for n in res.notes)
        self.mix_status.set_text(f"Master written to {res.path.name}: stereo, 48 kHz, 24-bit, "
                                 f"{self.project.target_lufs:.1f} LUFS target.{extra}")
        self._refresh_files()
        self.toast("Master ready")

    def _show_mix_stats(self):
        st = self.project.mix_stats or {}

        def f(k, signed=False):
            return "—" if st.get(k) is None else (f"{st[k]:+.1f}" if signed else f"{st[k]:.1f}")

        self.disp_lufs.set_text(f("after"))
        for k, signed in (("before", False), ("after", False), ("gain", True), ("tp", False)):
            self.stat[k].set_text(f(k, signed))
        ok = st.get("after") is not None and abs(st["after"] - self.project.target_lufs) < 0.6
        (self.stat["after"].add_css_class if ok else self.stat["after"].remove_css_class)("good")
        self._update_spec(st)

    def _update_spec(self, st):
        def mark(key, good, text):
            row, icon = self.spec_rows[key]
            row.set_subtitle(text)
            icon.set_from_icon_name("object-select-symbolic" if good else "dialog-warning-symbolic")
            (icon.remove_css_class if good else icon.add_css_class)("warning")
            (icon.add_css_class if good else icon.remove_css_class)("success")
        if st.get("after") is None:
            for key in self.spec_rows:
                self.spec_rows[key][0].set_subtitle("Not mixed yet")
                self.spec_rows[key][1].set_from_icon_name("content-loading-symbolic")
            return
        tgt = self.project.target_lufs
        mark("lufs", abs(st["after"] - tgt) <= 0.5 and abs(tgt + 16) < 0.01,
             f"{st['after']:.1f} LUFS" + ("" if abs(tgt + 16) < 0.01 else f"  ·  custom target {tgt:.1f}, podcast standard is −16"))
        tp = st.get("tp")
        if tp is None:                                   # session mixed before true peak was measured
            row, icon = self.spec_rows["tp"]
            row.set_subtitle("Press MIX to measure")
            icon.set_from_icon_name("content-loading-symbolic")
        else:
            mark("tp", tp <= -0.95, f"{tp:.1f} dBTP" + ("  ·  peaks were limited to fit" if st.get("limited") else ""))
        mark("fmt", True, "Stereo  ·  48 kHz  ·  24-bit WAV")

    # ------------------------------------------------------------------ export
    def export_mp3(self):
        p = self.project
        if not p.master_path.exists():
            self.toast("Mix the master first.")
            return
        if getattr(self, "export_busy", False):
            return
        self.export_busy = True
        self.export_btn.set_sensitive(False)
        self.export_btn.set_label("Encoding…")

        def work():
            try:
                res = render.export_mp3(p)
                GLib.idle_add(self._export_done, res, None)
            except Exception as e:
                GLib.idle_add(self._export_done, None, str(e))

        threading.Thread(target=work, daemon=True).start()

    def _export_done(self, res, err):
        self.export_busy = False
        self.export_btn.set_sensitive(True)
        self.export_btn.set_label("Export MP3")
        if err:
            self.toast(f"MP3 export failed: {err}")
            return
        self.mp3_note = f"verified {res.lufs:.1f} LUFS, {res.true_peak_db:.1f} dBTP" if res.lufs is not None else ""
        self._refresh_files()
        self.toast("MP3 exported and checked against the podcast spec")

    # ------------------------------------------------------------------ pads / hotkeys
    # ---- pads: one-shot, hold (momentary), toggle and loop
    def trigger(self, i: int, from_key: bool = False):
        """A complete tap: press then release. Kept for callers that don't distinguish the two."""
        self.pad_press(i, from_key)
        self.pad_release(i)

    def _pad_gain_db(self, pad) -> float:
        if pad.norm_db is None:                          # level-match older pads the first time they are used
            path = self.project.clips_dir / pad.clip
            try:
                pad.norm_db = render.clip_gain_db(render.read_stereo(path))
            except Exception:
                pad.norm_db = 0.0
            if self.project.created:
                self.project.save()
        return pad.norm_db + pad.gain_db

    def pad_press(self, i: int, from_key: bool = False):
        pad = self.project.pads[i]
        self.pads[i].flash()
        if not pad.clip:
            if not from_key:
                self.pads[i].edit.popup()
            return
        if not (self.project.clips_dir / pad.clip).exists():
            self.toast(f"Missing clip: {pad.clip}")
            return
        if pad.mode in ("toggle", "loop") and self.player.is_active(i):
            self._stop_pad(i)
        else:
            self._start_pad(i)

    def pad_release(self, i: int):
        if self.project.pads[i].mode == "momentary" and self.player.is_active(i):
            self._stop_pad(i)

    def _start_pad(self, i: int):
        pad = self.project.pads[i]
        gain = self._pad_gain_db(pad)
        if not self.project.hotkeys_muted:
            self.player.play(self.project.clips_dir / pad.clip, gain, duck=pad.duck, loop=(pad.mode == "loop"), handle=i)
        if self.engine.recording:
            t = self.engine.position()
            if t is not None:
                ev = Event(t=t, pad=i, clip=pad.clip, gain_db=gain, duck=pad.duck, loop=(pad.mode == "loop"))
                self.project.events.append(ev)
                if self._journal:
                    self._journal.hit(len(self.project.events) - 1, ev)
                if pad.mode != "once":
                    self._open_events[i] = ev                     # its length is known when the pad is released / toggled off

    def _stop_pad(self, i: int):
        self.player.stop(i)
        ev = self._open_events.pop(i, None)
        if ev is not None and self.engine.recording:
            t = self.engine.position()
            if t is not None:
                ev.dur = max(0.0, t - ev.t)
                self._journal_end(ev)

    def _discard_journal(self):
        if getattr(self, "_journal", None):
            self._journal.discard()
            self._journal = None

    def _journal_end(self, ev):
        if getattr(self, "_journal", None):
            idx = next((i for i, e in enumerate(self.project.events) if e is ev), None)
            if idx is not None:
                self._journal.end(idx, ev.dur)

    def _close_open_events(self, t_end: float | None):
        """The take ended while pads were still held or looping: end them at the take's end."""
        for i, ev in list(self._open_events.items()):
            if t_end is not None:
                ev.dur = max(0.0, t_end - ev.t)
                self._journal_end(ev)
        self._open_events.clear()

    def capture_key(self, keyval) -> bool:
        """Used while a pad is waiting for its new key; ignores everything otherwise."""
        return self.capture_for is not None and self._on_key(None, keyval, 0, 0)

    def _on_key(self, ctrl, keyval, keycode, state):
        name = Gdk.keyval_name(keyval) or ""
        if self.capture_for is not None:
            i, self.capture_for = self.capture_for, None
            if name != "Escape":
                self._materialize()
                self.project.pads[i].key = Gdk.keyval_to_unicode(keyval) and chr(Gdk.keyval_to_unicode(keyval)).lower() or name
                self.project.save()
            self.pads[i].refresh()
            if getattr(self.pads[i], "keybtn", None):
                self.pads[i].keybtn.set_label(f"Key: {self.project.pads[i].key.upper()}")
            return True
        if state & Gdk.ModifierType.CONTROL_MASK and name.lower() == "r":
            self.toggle_record()
            return True
        if state & (Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.ALT_MASK):
            return False
        if self.stack.get_visible_child_name() == "recordings" and not isinstance(self.get_focus(), Gtk.Editable):
            if self.recordings.on_key(name):
                return True
        if isinstance(self.get_focus(), Gtk.Editable) or (self.stack.get_visible_child_name() != "session") or self._gated():
            return False
        ch = chr(Gdk.keyval_to_unicode(keyval)).lower() if Gdk.keyval_to_unicode(keyval) else ""
        for i, p in enumerate(self.project.pads):
            if p.key and p.key.lower() == ch:
                if i not in self._held:                 # holding a key sends repeats; only the first press counts
                    self._held.add(i)
                    self.pad_press(i, from_key=True)
                return True
        return False

    def _on_key_released(self, ctrl, keyval, keycode, state):
        ch = chr(Gdk.keyval_to_unicode(keyval)).lower() if Gdk.keyval_to_unicode(keyval) else ""
        for i, p in enumerate(self.project.pads):
            if p.key and p.key.lower() == ch and i in self._held:
                self._held.discard(i)
                self.pad_release(i)

    def choose_clip(self, i: int):
        dlg = Gtk.FileDialog(title="Choose a sound")
        f = Gtk.FileFilter(name="Audio")
        f.add_mime_type("audio/*")
        flt = Gio.ListStore.new(Gtk.FileFilter)
        flt.append(f)
        dlg.set_filters(flt)

        def done(d, res):
            try:
                gf = d.open_finish(res)
            except GLib.Error:
                return
            self._import_clip(i, Path(gf.get_path()))

        dlg.open(self, None, done)

    def _import_clip(self, i: int, src: Path):
        self._materialize()
        self.project.ensure_dirs()
        dst = self.project.clips_dir / (src.stem + ".wav")
        n = 2
        while dst.exists():
            dst = self.project.clips_dir / f"{src.stem}-{n}.wav"
            n += 1
        def work():
            try:
                audio.import_clip(src, dst)
                GLib.idle_add(self._clip_ready, i, dst, None)
            except Exception as e:
                GLib.idle_add(self._clip_ready, i, dst, str(e))
        threading.Thread(target=work, daemon=True).start()

    def _clip_ready(self, i, dst: Path, err):
        if err:
            self.toast(f"Couldn't import that sound: {err}")
            return
        pad = self.project.pads[i]
        pad.clip = dst.name
        pad.norm_db = None
        self._pad_gain_db(pad)                      # measure it now so the first press is already level-matched
        if not pad.label:
            pad.label = dst.stem[:18]
        self.project.save()
        self.pads[i].refresh()
        self.toast(f"Added {dst.name} to pad {pad.key.upper()}")

    def set_pad_color(self, i, color):
        self.project.pads[i].color = color
        self.project.save()
        self._apply_pad_css()

    def clear_pad(self, i):
        p = self.project.pads[i]
        p.clip, p.label, p.gain_db = "", "", 0.0
        self.project.save()
        self.pads[i].refresh()

    def _apply_pad_css(self):
        css = "".join(f".pad-{i} .keycap {{ color: {p.color}; border-color: alpha({p.color}, .45); }}\n.pad-{i}.hit, .pad-{i}.playing {{ border-color: {p.color}; }}\n.pad-{i}:not(.empty) {{ border-bottom: 3px solid {p.color}; }}\n" for i, p in enumerate(self.project.pads))
        self._pad_css.load_from_string(css)

    # ------------------------------------------------------------------ sessions
    def new_session(self):
        if self.engine.recording:
            self.toast("Stop recording first.")
            return
        self.project = self._blank_project()
        self.cfg.pop("last_project", None)
        save_config(self.cfg)
        self._reload_project_ui()

    def open_session(self):
        dlg = Gtk.FileDialog(title="Open a PodStudio session folder")
        dlg.set_initial_folder(Gio.File.new_for_path(str(DEFAULT_ROOT if DEFAULT_ROOT.exists() else Path.home())))

        def done(d, res):
            try:
                gf = d.select_folder_finish(res)
                self.project = Project.load(Path(gf.get_path()))
            except GLib.Error:
                return
            except Exception as e:
                self.toast(f"Not a PodStudio session: {e}")
                return
            self._remember()
            self._reload_project_ui()

        dlg.select_folder(self, None, done)

    def _reload_project_ui(self):
        pr = self.project
        self.title_label.set_text(pr.name or "New session")
        self.mic_strip.fader.set_value(pr.mic_db)
        self.hk_strip.fader.set_value(pr.hotkeys_db)
        self.hk_strip.mute.set_active(pr.hotkeys_muted)
        self.master_strip.fader.set_value(pr.target_lufs)
        self._fill_pads()
        self._apply_pad_css()
        self._refresh_files()
        self._sync_mix_settings()
        self.art_card.sync()
        self.publish._show_state()
        self._show_mix_stats()
        self.timecode.set_text(fmt_time(pr.mic_duration))
        self.script.reload()

    def open_folder(self):
        if self.project.created:
            Gtk.FileLauncher.new(Gio.File.new_for_path(str(self.project.root))).launch(self, None, None, None)
        else:
            self.toast("This session hasn't been saved yet.")

    # ------------------------------------------------------------------ misc
    def save_cfg(self):
        save_config(self.cfg)

    def toast(self, msg: str):
        self.toasts.add_toast(Adw.Toast(title=msg, timeout=4))

    def _on_close(self, *_):
        if self.engine.recording:
            self.engine.stop_recording(lambda: None)
        self.engine.stop()
        self.player.stop_all()
        self.recordings.shutdown()
        if self.mic:
            self.mic.close()
        self.script.flush()
        if self.project and self.project.created:
            self.project.save()
        return False
