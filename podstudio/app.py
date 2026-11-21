"""Application entry point."""
from __future__ import annotations

import os
import sys
from importlib import resources

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, Gdk, Gio, Gtk  # noqa: E402

from . import __version__  # noqa: E402
from .window import PodStudioWindow  # noqa: E402

APP_ID = "io.github.thetylerwoodwardproject.PodStudio"


class PodStudioApp(Adw.Application):
    def __init__(self):
        flags = Gio.ApplicationFlags.DEFAULT_FLAGS
        if os.environ.get("PODSTUDIO_NON_UNIQUE"):                  # run beside an already-open copy (testing)
            flags |= Gio.ApplicationFlags.NON_UNIQUE
        super().__init__(application_id=APP_ID, flags=flags)
        self.win = None

    def do_startup(self):
        Adw.Application.do_startup(self)
        Adw.StyleManager.get_default().set_color_scheme(Adw.ColorScheme.FORCE_DARK)
        css = Gtk.CssProvider()
        css.load_from_path(str(resources.files("podstudio").joinpath("data/style.css")))
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        about = Gio.SimpleAction.new("about", None)
        about.connect("activate", self._about)
        self.add_action(about)
        q = Gio.SimpleAction.new("quit", None)
        q.connect("activate", lambda *_: self.quit())
        self.add_action(q)
        self.set_accels_for_action("app.quit", ["<Primary>q"])

    def do_activate(self):
        if not self.win:
            self.win = PodStudioWindow(self)
        self.win.present()

    def _about(self, *_):
        d = Adw.AboutDialog(
            application_name="PodStudio", application_icon=APP_ID, version=f"v{__version__}",
            developer_name="The Tyler Woodward Project", license_type=Gtk.License.MIT_X11,
            website="https://github.com/thetylerwoodwardproject/podstudio",
            comments=("Record a USB mic, fire hotkey sounds on their own track, and master to −16 LUFS.\n\n"
                      "PodStudio is an independent project. It is not affiliated with, endorsed by, or "
                      "sponsored by RØDE Microphones. RØDE and PodMic are trademarks of their owner."),
            copyright="© 2026 The Tyler Woodward Project",
        )
        d.add_acknowledgement_section("Protocol research", ["podmicusb-doctor by rumkit https://github.com/rumkit/podmicusb-doctor"])
        d.present(self.win)


def main():
    return PodStudioApp().run(sys.argv)
