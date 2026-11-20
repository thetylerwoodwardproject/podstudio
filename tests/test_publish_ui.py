import json
import time

import pytest

gi = pytest.importorskip("gi")
gi.require_version("Gtk", "4.0")
from gi.repository import GLib, Gtk  # noqa: E402

if not Gtk.init_check():
    pytest.skip("needs a display", allow_module_level=True)

from podstudio import buzzsprout as bz, credentials, publish_ui  # noqa: E402
from podstudio.render import mix_master  # noqa: E402
from tests.test_buzzsprout import TOKEN, Mock, server  # noqa: E402,F401
from tests.test_render import _project  # noqa: E402


RealClient = bz.Client          # captured before any monkeypatching replaces it


class FakeWin:
    def __init__(self, project):
        self.project, self.cfg, self.toasts = project, {}, []
    def toast(self, m): self.toasts.append(m)
    def save_cfg(self): pass


def pump(cond, timeout=30):
    ctx, end = GLib.MainContext.default(), time.time() + timeout
    while not cond():
        ctx.iteration(False)
        time.sleep(0.01)
        assert time.time() < end, "timed out"


@pytest.fixture
def panel(server, tmp_path, monkeypatch):
    srv, S = server
    keyring = {}
    monkeypatch.setattr(credentials, "store", lambda t: keyring.setdefault("t", t) and True)   # never touch the real keyring
    monkeypatch.setattr(credentials, "load", lambda: keyring.get("t"))
    monkeypatch.setattr(credentials, "clear", lambda: keyring.clear())
    monkeypatch.setattr(publish_ui.buzzsprout, "Client",
                        lambda tok: RealClient(tok, base=f"http://127.0.0.1:{srv.server_port}", sleep=lambda s: None))
    p = _project(tmp_path)
    mix_master(p)
    w = FakeWin(p)
    return publish_ui.PublishPanel(w), w, S, keyring


def test_connect_then_draft_upload_then_confirmed_publish(panel):
    pn, w, S, keyring = panel
    assert not pn._connected() and pn.token_row.get_visible() and not pn.upload_row.get_visible()
    pn.token_row.set_text(TOKEN)
    pn.connect_account()
    pump(lambda: pn._connected())
    assert keyring["t"] == TOKEN and pn.upload_row.get_visible() and not pn.token_row.get_visible()
    assert pn.title_row.get_text() == w.project.name                       # defaults to the session name

    pn.title_row.set_text("Episode One"); pn.desc_row.set_text("Show notes"); pn.ep_row.set_value(3)
    pn.upload()
    pump(lambda: not pn.busy and w.project.buzz.get("episode_id") and not pn.status_row.get_visible())
    created = json.loads([c for c in S["calls"] if c[0] == "POST" and c[1] == "/api/7/episodes"][0][3])
    assert created["private"] is True and created["title"] == "Episode One" and created["episode_number"] == 3
    assert w.project.buzz == {"podcast_id": 7, "episode_id": 99, "public": False}
    assert w.project.mp3_path.exists()                                      # encoded on demand
    assert not any(json.loads(c[3] or b"{}").get("private") is False for c in S["calls"] if c[0] in ("POST", "PATCH"))
    assert pn.result_row.get_visible() and pn.publish_btn.get_visible()

    pn._publish()                                                           # what the confirmed dialog calls
    pump(lambda: w.project.buzz.get("public"))
    assert any(c[0] == "PATCH" and json.loads(c[3]) == {"private": False} for c in S["calls"])
    assert not pn.publish_btn.get_visible()
    saved = json.loads(w.project.file.read_text())
    assert saved["buzz"]["episode_id"] == 99 and TOKEN not in json.dumps(saved)   # the token is never in the project file


def test_bad_token_stays_disconnected(panel):
    pn, w, S, keyring = panel
    pn.token_row.set_text("wrong")
    pn.connect_account()
    pump(lambda: w.toasts)
    assert not pn._connected() and "t" not in keyring and "token" in w.toasts[-1].lower()


def test_second_upload_updates_the_same_draft(panel):
    pn, w, S, keyring = panel
    pn.token_row.set_text(TOKEN); pn.connect_account(); pump(lambda: pn._connected())
    pn.upload(); pump(lambda: w.project.buzz.get("episode_id") and not pn.busy)
    n_creates = sum(1 for c in S["calls"] if c[0] == "POST" and c[1] == "/api/7/episodes")
    S["polls"] = 0
    pn.upload(); pump(lambda: not pn.busy and S["polls"] >= 3)
    assert sum(1 for c in S["calls"] if c[0] == "POST" and c[1] == "/api/7/episodes") == n_creates == 1
    assert any(c[0] == "PATCH" and c[1] == "/api/7/episodes/99" for c in S["calls"])


def test_disconnect_forgets_the_token(panel):
    pn, w, S, keyring = panel
    pn.token_row.set_text(TOKEN); pn.connect_account(); pump(lambda: pn._connected())
    pn.disconnect()
    assert not keyring and not pn._connected() and pn.token_row.get_visible()
