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
    assert any(c[0] == "PATCH" and json.loads(c[3]) == {"private": False, "explicit": False} for c in S["calls"])
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


def _png(path, px=1400):
    gi.require_version("GdkPixbuf", "2.0")
    from gi.repository import GdkPixbuf
    GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, False, 8, px, px).savev(str(path), "png", [], [])
    return path


def test_art_and_chapters_go_up_with_the_draft(panel, tmp_path):
    from podstudio import artwork
    pn, w, S, keyring = panel
    p = w.project
    artwork.import_art(p, _png(tmp_path / "cover.png"))
    p.chapters = [{"t": 3.0, "title": "Main topic"}, {"t": 8.0, "title": "Wrap up"}, {"t": 9999.0, "title": "After the end"}]   # the take is 12 s long
    p.save()
    pn.token_row.set_text(TOKEN); pn.connect_account(); pump(lambda: pn._connected())
    pn.explicit_row.set_active(True)
    pn.upload()
    pump(lambda: not pn.busy and p.buzz.get("episode_id") and not pn.status_row.get_visible())

    patches = [c for c in S["calls"] if c[0] == "PATCH" and "multipart" in (c[2].get("Content-Type") or "")]
    assert len(patches) == 1 and b'name="explicit"\r\n\r\ntrue' in patches[0][3] and b'filename="cover.png"' in patches[0][3]
    put = json.loads([c for c in S["calls"] if c[0] == "PUT" and c[1].endswith("/chapters")][0][3])
    assert [(c["title"], c["start_time"]) for c in put["chapters"]] == [("Intro", "00:00:00"), ("Main topic", "00:00:03"), ("Wrap up", "00:00:08")]
    assert any("Intro" in m for m in w.toasts)                        # the user is told what was changed or dropped
    assert any("Draft is on Buzzsprout" in m for m in w.toasts)
    assert p.buzz["art_key"]

    S["calls"].clear(); S["polls"] = 0
    pn.upload(); pump(lambda: not pn.busy and S["polls"] >= 3)
    assert not [c for c in S["calls"] if c[0] == "PATCH" and "multipart" in (c[2].get("Content-Type") or "")]   # unchanged art isn't re-sent


def test_a_failed_cover_upload_does_not_lose_the_draft(panel, tmp_path, monkeypatch):
    from podstudio import artwork
    pn, w, S, keyring = panel
    artwork.import_art(w.project, _png(tmp_path / "cover.png"))
    pn.token_row.set_text(TOKEN); pn.connect_account(); pump(lambda: pn._connected())
    monkeypatch.setattr(RealClient, "set_artwork", lambda *a, **k: (_ for _ in ()).throw(bz.BuzzsproutError("image rejected")))
    pn.upload()
    pump(lambda: not pn.busy and w.project.buzz.get("episode_id") and not pn.status_row.get_visible())
    assert any("Cover art wasn't uploaded: image rejected" in m for m in w.toasts)
    assert any(c[1].endswith("/uploads/up%2F1/complete") for c in S["calls"])      # the audio still went up


def test_chapters_that_all_get_dropped_never_wipe_the_servers(panel):
    pn, w, S, keyring = panel
    w.project.chapters = [{"t": 500.0, "title": "Past the end of a 12 s take"}]
    pn.token_row.set_text(TOKEN); pn.connect_account(); pump(lambda: pn._connected())
    pn.upload()
    pump(lambda: not pn.busy and w.project.buzz.get("episode_id") and not pn.status_row.get_visible())
    assert not [c for c in S["calls"] if c[0] == "PUT" and c[1].endswith("/chapters")]      # an empty PUT would delete them all
    assert any("None of the chapters could be uploaded" in m for m in w.toasts)


def test_removing_every_chapter_clears_the_ones_already_uploaded(panel):
    pn, w, S, keyring = panel
    w.project.chapters = [{"t": 2.0, "title": "One"}]
    pn.token_row.set_text(TOKEN); pn.connect_account(); pump(lambda: pn._connected())
    pn.upload(); pump(lambda: not pn.busy and w.project.buzz.get("chapters_sent") and not pn.status_row.get_visible())
    w.project.chapters = []                                   # the user deleted them all
    S["calls"].clear(); S["polls"] = 0
    pn.upload(); pump(lambda: not pn.busy and S["polls"] >= 3)
    puts = [json.loads(c[3]) for c in S["calls"] if c[0] == "PUT" and c[1].endswith("/chapters")]
    assert puts == [{"chapters": []}] and w.project.buzz["chapters_sent"] is False
