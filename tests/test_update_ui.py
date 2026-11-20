import time
import types

import pytest

gi = pytest.importorskip("gi")
gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import GLib, Gtk  # noqa: E402

if not Gtk.init_check():
    pytest.skip("needs a display", allow_module_level=True)

from podstudio import update_ui, updates  # noqa: E402
from tests.test_updates import NAME, server  # noqa: E402,F401


def pump(cond, timeout=20):
    ctx, end = GLib.MainContext.default(), time.time() + timeout
    while not cond():
        ctx.iteration(False)
        time.sleep(0.01)
        assert time.time() < end, "timed out"


def make(server, tmp_path, monkeypatch, recording=False):
    base, S = server
    info = updates.check("2026.11.20", base=base, repo="o/r")
    calls = {"downloads": 0, "installs": 0, "popen": 0, "quit": 0, "toasts": []}
    real = updates.download
    def download(i, progress=None):
        calls["downloads"] += 1
        return real(i, progress=progress, base=base, cache=tmp_path)
    def install(deb):
        calls["installs"] += 1
        return "Installed."
    monkeypatch.setattr(updates, "download", download)
    monkeypatch.setattr(updates, "install", install)
    monkeypatch.setattr(updates, "installed_from_deb", lambda: True)
    fake_sp = types.SimpleNamespace(Popen=lambda *a, **k: calls.__setitem__("popen", calls["popen"] + 1), DEVNULL=-3)
    monkeypatch.setattr(update_ui, "subprocess", fake_sp)           # only the dialog's reference, not the shared module
    app = types.SimpleNamespace(quit=lambda: calls.__setitem__("quit", calls["quit"] + 1))
    win = types.SimpleNamespace(engine=types.SimpleNamespace(recording=recording), toast=calls["toasts"].append,
                                update_btn=Gtk.Button(), get_application=lambda: app)
    return update_ui.UpdateDialog(win, info), calls, win


def test_install_then_restart_without_installing_twice(server, tmp_path, monkeypatch):
    d, calls, win = make(server, tmp_path, monkeypatch)
    assert d.go_btn.get_sensitive() and d.go_btn.get_label() == "Download and install"
    d._primary()
    pump(lambda: d.done_ok)
    assert calls["downloads"] == 1 and calls["installs"] == 1
    assert "Updated to v2026.12.05" in d.status.get_text() and d.go_btn.get_label() == "Restart now"
    d._primary()                                              # the same button now restarts
    assert calls["downloads"] == 1 and calls["installs"] == 1 and calls["popen"] == 1 and calls["quit"] == 1
    assert not win.update_btn.get_visible()


def test_nothing_is_installed_while_recording(server, tmp_path, monkeypatch):
    d, calls, win = make(server, tmp_path, monkeypatch, recording=True)
    d._primary()
    assert calls["downloads"] == 0 and calls["installs"] == 0 and any("recording" in t for t in calls["toasts"])


def test_a_failed_authorization_leaves_the_dialog_usable(server, tmp_path, monkeypatch):
    d, calls, win = make(server, tmp_path, monkeypatch)
    monkeypatch.setattr(updates, "install", lambda deb: (_ for _ in ()).throw(updates.UpdateError("The installation wasn't authorized.")))
    d._primary()
    pump(lambda: not d.busy)
    assert "wasn't authorized" in d.status.get_text() and not d.done_ok and d.go_btn.get_sensitive()   # can try again


def test_a_tampered_download_is_refused_and_nothing_runs(server, tmp_path, monkeypatch):
    d, calls, win = make(server, tmp_path, monkeypatch)
    server[1]["deb"] = b"tampered bytes"
    d._primary()
    pump(lambda: not d.busy)
    assert "checksum" in d.status.get_text() and calls["installs"] == 0 and list(tmp_path.iterdir()) == []


def test_releases_that_cannot_be_verified_do_not_offer_install(server, tmp_path, monkeypatch):
    base, S = server
    S["no_sha"] = True
    info = updates.check("2026.11.20", base=base, repo="o/r")
    monkeypatch.setattr(updates, "installed_from_deb", lambda: True)
    d = update_ui.UpdateDialog(types.SimpleNamespace(engine=types.SimpleNamespace(recording=False)), info)
    assert not d.go_btn.get_sensitive() and "checksum" in d.note.get_text()
    monkeypatch.setattr(updates, "installed_from_deb", lambda: False)
    S.pop("no_sha")
    d2 = update_ui.UpdateDialog(types.SimpleNamespace(engine=types.SimpleNamespace(recording=False)), updates.check("2026.11.20", base=base, repo="o/r"))
    assert not d2.go_btn.get_sensitive() and "installed from the .deb" in d2.note.get_text()
