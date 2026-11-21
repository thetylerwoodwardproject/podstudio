"""The 'Update available' dialog: release notes, download with progress, then install."""
from __future__ import annotations

import subprocess
import threading

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, GLib, Gtk  # noqa: E402

from . import runtime, updates


class UpdateDialog(Adw.Dialog):
    def __init__(self, win, info: updates.UpdateInfo):
        super().__init__(title="Update available", content_width=480)
        self.win, self.info, self.busy, self.done_ok = win, info, False, False
        self.ready_setup = None                  # Windows: the verified setup program, waiting for "Install and restart"
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12, margin_top=20, margin_bottom=20, margin_start=24, margin_end=24)

        head = Gtk.Label(label=f"PodStudio v{info.version} is available", xalign=0, wrap=True)
        head.add_css_class("vd-title")
        sub = Gtk.Label(label=f"You have v{updates.current_version()}.", xalign=0)
        sub.add_css_class("vd-sub")
        box.append(head)
        box.append(sub)

        notes = (info.notes or "No release notes.")[:1800]
        nl = Gtk.Label(label=notes, xalign=0, yalign=0, wrap=True, selectable=True, focusable=False)   # focusable would select all on open
        nl.add_css_class("vd-sub")
        sw = Gtk.ScrolledWindow(min_content_height=70, max_content_height=170, propagate_natural_height=True,
                                hscrollbar_policy=Gtk.PolicyType.NEVER)
        sw.set_child(nl)
        frame = Gtk.Box(css_classes=["wave-frame"])
        frame.append(sw)
        sw.set_hexpand(True)
        box.append(frame)

        self.note = Gtk.Label(label="", xalign=0, wrap=True)
        self.note.add_css_class("vd-sub")
        if info.problems:
            self.note.set_text(" ".join(info.problems))
            self.note.add_css_class("art-warn")
        elif not updates.can_self_install():
            self.note.set_text(f"This copy wasn't installed from {updates.how_installed()}, so install the new version the "
                               "same way you installed this one. The release page has the download.")
        elif runtime.IS_WINDOWS:
            self.note.set_text("The download is checked against the checksum published with the release. PodStudio "
                               "closes while the installer runs, then opens again. Your sessions are not touched.")
        else:
            self.note.set_text("The download is checked against the checksum published with the release. "
                               "You'll be asked for your password to install it.")
        box.append(self.note)

        self.bar = Gtk.ProgressBar(visible=False)
        self.status = Gtk.Label(label="", xalign=0, wrap=True, visible=False)
        self.status.add_css_class("vd-sub")
        box.append(self.bar)
        box.append(self.status)

        btns = Gtk.Box(spacing=8, halign=Gtk.Align.END, margin_top=4)
        self.view_btn = Gtk.Button(label="View release")
        self.later_btn = Gtk.Button(label="Later")
        self.go_btn = Gtk.Button(label="Download and install")
        for b in (self.view_btn, self.later_btn):
            b.add_css_class("chip-btn")
        self.go_btn.add_css_class("mix-btn")
        self.go_btn.set_sensitive(info.can_install and updates.can_self_install())
        self.view_btn.connect("clicked", lambda *_: Gtk.UriLauncher.new(info.page).launch(win, None, None, None))
        self.later_btn.connect("clicked", lambda *_: self.close())
        self.go_btn.connect("clicked", lambda *_: self._primary())
        for b in (self.view_btn, self.later_btn, self.go_btn):
            btns.append(b)
        box.append(btns)
        self.set_child(box)

    # ------------------------------------------------------------------ steps
    def _say(self, text: str, frac: float | None = None, error: bool = False):
        self.status.set_visible(True)
        self.status.set_text(text)
        (self.status.add_css_class if error else self.status.remove_css_class)("art-warn")
        if frac is None:
            self.bar.set_visible(not error)
            if not error:
                self.bar.pulse()
        else:
            self.bar.set_visible(True)
            self.bar.set_fraction(max(0.0, min(1.0, frac)))

    def _primary(self):
        """One button, two phases: install, and once that has finished, restart. Never both."""
        if self.ready_setup is not None:
            self._install_and_quit()
        elif self.done_ok:
            self._restart()
        else:
            self._go()

    def _go(self):
        if self.busy or self.done_ok:
            return
        if self.win.engine.recording:
            self.win.toast("Finish your recording before updating.")
            return
        self.busy = True
        for b in (self.go_btn, self.later_btn):
            b.set_sensitive(False)

        def ui(text, frac=None):
            GLib.idle_add(lambda: (self._say(text, frac), False)[1])

        def work():
            ui("Downloading…", 0.0)
            deb = updates.download(self.info, progress=lambda a, b: ui(
                f"Downloading… {a / 1e6:.1f} of {b / 1e6:.1f} MB" if b else f"Downloading… {a / 1e6:.1f} MB", (a / b) if b else None))
            if runtime.IS_WINDOWS:                    # setup can't replace files that are in use: it runs after we close
                return deb
            ui("Verified. Waiting for you to authorize the installation…")
            return updates.install(deb)

        def finish(_res, err):
            self.busy = False
            self.later_btn.set_sensitive(True)
            if err:
                self.go_btn.set_sensitive(True)
                self._say(err, error=True)
                return
            if runtime.IS_WINDOWS:
                self.ready_setup = _res
                self.bar.set_visible(False)
                self._say(f"Downloaded and verified v{self.info.version}. PodStudio will close, update, and open again.")
                self.go_btn.set_label("Install and restart")
                self.go_btn.set_sensitive(True)
                return
            self.done_ok = True
            self.bar.set_visible(False)
            self._say(f"Updated to v{self.info.version}. Restart PodStudio to use it.")
            self.go_btn.set_label("Restart now")
            self.go_btn.set_sensitive(True)
            self.later_btn.set_label("Close")
            self.win.update_btn.set_visible(False)

        def target():
            try:
                res, err = work(), None
            except updates.UpdateError as e:
                res, err = None, str(e)
            except Exception as e:
                res, err = None, f"{type(e).__name__}: {e}"
            GLib.idle_add(lambda: (finish(res, err), False)[1])

        threading.Thread(target=target, daemon=True).start()

    def _install_and_quit(self):
        if self.win.engine.recording:
            self.win.toast("Finish your recording first, then install the update.")
            return
        try:
            updates.start_windows_installer(self.ready_setup)
        except updates.UpdateError as e:
            self._say(str(e), error=True)
            return
        self.win.get_application().quit()

    def _restart(self):
        if not self.done_ok:
            return
        if self.win.engine.recording:
            self.win.toast("Finish your recording first, then restart.")
            return
        try:
            subprocess.Popen(["podstudio"], start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError:
            self.win.toast("Couldn't restart automatically. Please open PodStudio again.")
            return
        self.win.get_application().quit()
