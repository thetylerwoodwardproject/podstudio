"""The 'Publish to Buzzsprout' section of the Mix page."""
from __future__ import annotations

import threading
import time

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, Gio, GLib, Gtk  # noqa: E402

from . import buzzsprout, credentials, render  # noqa: E402


class PublishPanel:
    def __init__(self, win):
        self.win = win
        self.client: buzzsprout.Client | None = None
        self.podcasts: list[dict] = []
        self.busy = False
        self._syncing = False

        g = self.group = Adw.PreferencesGroup(
            title="Publish to Buzzsprout",
            description="Uploads the MP3 as a private draft. Nothing goes public until you press Publish.")

        # -- not connected
        self.token_row = Adw.PasswordEntryRow(title="API token (Buzzsprout: Profile → API)")
        self.connect_btn = Gtk.Button(label="Connect", valign=Gtk.Align.CENTER)
        self.connect_btn.add_css_class("suggested-action")
        self.connect_btn.connect("clicked", lambda *_: self.connect_account())
        self.token_row.add_suffix(self.connect_btn)
        self.token_row.connect("apply", lambda *_: self.connect_account())
        g.add(self.token_row)

        # -- connected
        self.podcast_row = Adw.ComboRow(title="Podcast")
        self.podcast_row.connect("notify::selected", self._on_podcast)
        self.disconnect_btn = Gtk.Button(label="Disconnect", valign=Gtk.Align.CENTER)
        self.disconnect_btn.connect("clicked", lambda *_: self.disconnect())
        self.podcast_row.add_suffix(self.disconnect_btn)
        g.add(self.podcast_row)

        self.title_row = Adw.EntryRow(title="Title")
        self.desc_row = Adw.EntryRow(title="Description")
        self.tags_row = Adw.EntryRow(title="Tags (comma separated)")
        self.ep_row = Adw.SpinRow(title="Episode number", subtitle="0 leaves it blank",
                                  adjustment=Gtk.Adjustment(value=0, lower=0, upper=9999, step_increment=1, page_increment=10))
        self.season_row = Adw.SpinRow(title="Season", subtitle="0 leaves it blank",
                                      adjustment=Gtk.Adjustment(value=0, lower=0, upper=999, step_increment=1, page_increment=5))
        self.explicit_row = Adw.SwitchRow(title="Explicit")
        for r in (self.title_row, self.desc_row, self.tags_row):
            r.connect("changed", lambda *_: self._save_form())
        for r in (self.ep_row, self.season_row):
            r.connect("notify::value", lambda *_: self._save_form())
        self.explicit_row.connect("notify::active", lambda *_: self._save_form())
        self.form_rows = [self.title_row, self.desc_row, self.tags_row, self.ep_row, self.season_row, self.explicit_row]
        for r in self.form_rows:
            g.add(r)

        self.upload_row = Adw.ActionRow(title="Upload as draft", subtitle="Encodes the MP3 first if needed")
        self.upload_btn = Gtk.Button(label="Upload draft", valign=Gtk.Align.CENTER)
        self.upload_btn.add_css_class("suggested-action")
        self.upload_btn.connect("clicked", lambda *_: self.upload())
        self.upload_row.add_suffix(self.upload_btn)
        g.add(self.upload_row)

        self.bar = Gtk.ProgressBar(valign=Gtk.Align.CENTER, hexpand=True)
        self.status_row = Adw.ActionRow(title="")
        self.status_row.add_suffix(self.bar)
        g.add(self.status_row)

        self.result_row = Adw.ActionRow(title="Draft on Buzzsprout")
        self.open_btn = Gtk.Button(label="Open", valign=Gtk.Align.CENTER)
        self.open_btn.connect("clicked", lambda *_: self.open_episode())
        self.publish_btn = Gtk.Button(label="Publish…", valign=Gtk.Align.CENTER)
        self.publish_btn.add_css_class("destructive-action")
        self.publish_btn.connect("clicked", lambda *_: self.confirm_publish())
        self.result_row.add_suffix(self.open_btn)
        self.result_row.add_suffix(self.publish_btn)
        g.add(self.result_row)

        self._show_state()
        self._try_saved_token()

    # ------------------------------------------------------------------ state
    @property
    def project(self):
        return self.win.project

    def _connected(self) -> bool:
        return self.client is not None and bool(self.podcasts)

    def _show_state(self):
        on = self._connected()
        self.token_row.set_visible(not on)
        self.podcast_row.set_visible(on)
        for r in self.form_rows + [self.upload_row]:
            r.set_visible(on)
        self.status_row.set_visible(False)
        has_ep = on and bool(self.project.buzz.get("episode_id"))
        self.result_row.set_visible(has_ep)
        if has_ep:
            self.result_row.set_title("Episode on Buzzsprout" if self.project.buzz.get("public") else "Draft on Buzzsprout")
            self.result_row.set_subtitle("Public" if self.project.buzz.get("public") else "Private. Only you can see it.")
            self.publish_btn.set_visible(not self.project.buzz.get("public"))
        self.upload_btn.set_label("Update draft" if has_ep else "Upload draft")
        self.sync_form()

    def sync_form(self):
        """Fill the form from the current project (title defaults to the session name)."""
        ep = self.project.episode
        self._syncing = True
        try:
            self.title_row.set_text(ep.get("title") or self.project.name or "")
            self.desc_row.set_text(ep.get("description", ""))
            self.tags_row.set_text(ep.get("tags", ""))
            self.ep_row.set_value(ep.get("episode_number") or 0)
            self.season_row.set_value(ep.get("season_number") or 0)
            self.explicit_row.set_active(bool(ep.get("explicit", False)))
        finally:
            self._syncing = False

    def _save_form(self):
        if self._syncing:
            return
        self.project.episode = {
            "title": self.title_row.get_text(), "description": self.desc_row.get_text(),
            "tags": self.tags_row.get_text(), "episode_number": int(self.ep_row.get_value()),
            "season_number": int(self.season_row.get_value()), "explicit": self.explicit_row.get_active()}
        if self.project.created:
            self.project.save()

    def _say(self, text: str, fraction: float | None = None):
        self.status_row.set_visible(True)
        self.status_row.set_title(text)
        if fraction is None:
            self.bar.pulse()
        else:
            self.bar.set_fraction(max(0.0, min(1.0, fraction)))

    def _set_busy(self, busy: bool):
        self.busy = busy
        self.upload_btn.set_sensitive(not busy)
        self.connect_btn.set_sensitive(not busy)
        self.publish_btn.set_sensitive(not busy)
        if not busy:
            self.status_row.set_visible(False)

    def _run(self, work, done):
        """Run blocking network work off the UI thread; call done(result, error) back on it."""
        def target():
            try:
                res, err = work(), None
            except buzzsprout.BuzzsproutError as e:
                res, err = None, str(e)
            except Exception as e:                       # surfaced to the user, never silent
                res, err = None, f"{type(e).__name__}: {e}"
            GLib.idle_add(lambda: (done(res, err), False)[1])
        threading.Thread(target=target, daemon=True).start()

    # ------------------------------------------------------------------ connect
    def _try_saved_token(self):
        """Look in the keyring off the UI thread: unlocking it can prompt and would otherwise freeze the window."""
        self._run(credentials.load, lambda token, _err: token and self._verify(token, silent=True))

    def connect_account(self):
        token = self.token_row.get_text().strip()
        if not token:
            self.win.toast("Paste your Buzzsprout API token first.")
            return
        self._verify(token, silent=False)

    def _verify(self, token: str, silent: bool):
        try:
            client = buzzsprout.Client(token)
        except buzzsprout.BuzzsproutError as e:
            self.win.toast(str(e))
            return
        self._set_busy(True)
        if not silent:
            self._say("Checking your token…")

        def done(pods, err):
            self._set_busy(False)
            if err or not pods:
                if not silent:
                    self.win.toast(err or "That account has no podcasts.")
                return
            self.client, self.podcasts = client, pods
            if not silent:
                saved = credentials.store(token)
                self.token_row.set_text("")
                self.win.toast("Connected to Buzzsprout." if saved else
                               "Connected. The system keyring isn't available, so you'll need the token again next time.")
            names = Gtk.StringList.new([p["title"] for p in pods])
            want = self.win.cfg.get("buzzsprout_podcast_id")
            idx = next((i for i, p in enumerate(pods) if p["id"] == want), 0)
            self._syncing = True
            self.podcast_row.set_model(names)
            self.podcast_row.set_selected(idx)
            self._syncing = False
            self._show_state()

        self._run(client.podcasts, done)

    def disconnect(self):
        credentials.clear()
        self.client, self.podcasts = None, []
        self.win.cfg.pop("buzzsprout_podcast_id", None)
        self.win.save_cfg()
        self._show_state()
        self.win.toast("Disconnected. The token was removed from your keyring.")

    def _on_podcast(self, *_):
        if self._syncing or not self.podcasts:
            return
        i = self.podcast_row.get_selected()
        if i < len(self.podcasts):
            self.win.cfg["buzzsprout_podcast_id"] = self.podcasts[i]["id"]
            self.win.save_cfg()

    def _podcast_id(self) -> int:
        i = min(self.podcast_row.get_selected(), len(self.podcasts) - 1)
        return self.podcasts[i]["id"]

    # ------------------------------------------------------------------ upload a draft
    def upload(self):
        p = self.project
        if self.busy or not self._connected():
            return
        if not p.created or not p.master_path.exists():
            self.win.toast("Mix the master first.")
            return
        title = self.title_row.get_text().strip()
        if not title:
            self.win.toast("Give the episode a title.")
            return
        self._save_form()
        pid, client = self._podcast_id(), self.client
        ep = p.episode
        fields = {"description": ep.get("description", ""), "tags": ep.get("tags", ""),
                  "explicit": bool(ep.get("explicit")), "episode_number": ep.get("episode_number") or None,
                  "season_number": ep.get("season_number") or None}
        existing = p.buzz.get("episode_id") if p.buzz.get("podcast_id") == pid else None
        self._set_busy(True)
        GLib.idle_add(self._say, "Preparing the MP3…")

        def ui(text, frac=None):
            GLib.idle_add(lambda: (self._say(text, frac), False)[1])

        def work():
            if not p.mp3_path.exists() or p.mp3_path.stat().st_mtime < p.master_path.stat().st_mtime:
                ui("Encoding the MP3…")
                render.export_mp3(p)
            if existing:
                ui("Updating the episode…")
                client.update_episode(pid, existing, title=title, **{k: v for k, v in fields.items() if v is not None})
                eid = existing
            else:
                ui("Creating the draft…")
                eid = client.create_episode(pid, title, **fields)["id"]
            p.buzz = {"podcast_id": pid, "episode_id": eid, "public": False}
            client.upload_audio(pid, eid, p.mp3_path, progress=lambda a, b: ui(f"Uploading… {a / 1e6:.1f} of {b / 1e6:.1f} MB", a / b))
            ui("Buzzsprout is processing the audio…")
            client.wait_until_encoded(pid, eid, on_poll=lambda e: ui("Buzzsprout is processing the audio…"))
            return eid

        def done(eid, err):
            self._set_busy(False)
            if err:
                self.win.toast(f"Upload didn't finish: {err}")
                if self.project.buzz.get("episode_id"):       # the draft exists; keep it so a retry updates it
                    self.project.save()
                self._show_state()
                return
            self.project.save()
            self._show_state()
            self.win.toast("Draft is on Buzzsprout, still private.")

        self._run(work, done)

    # ------------------------------------------------------------------ publish (explicit, confirmed)
    def confirm_publish(self):
        if self.busy or not self.project.buzz.get("episode_id"):
            return
        d = Adw.AlertDialog(
            heading="Publish this episode?",
            body="It will go live in your public podcast feed on Buzzsprout and show up in listeners' apps. "
                 "You can make it private again from here or on buzzsprout.com.")
        d.add_response("cancel", "Cancel")
        d.add_response("publish", "Publish")
        d.set_response_appearance("publish", Adw.ResponseAppearance.DESTRUCTIVE)
        d.set_default_response("cancel")
        d.set_close_response("cancel")
        d.connect("response", lambda _d, r: r == "publish" and self._publish())
        d.present(self.win)

    def _publish(self):
        b, client = self.project.buzz, self.client
        self._set_busy(True)
        self._say("Publishing…")

        def done(_res, err):
            self._set_busy(False)
            if err:
                self.win.toast(f"Couldn't publish: {err}")
                return
            self.project.buzz["public"] = True
            self.project.save()
            self._show_state()
            self.win.toast("Published on Buzzsprout.")

        self._run(lambda: client.publish(b["podcast_id"], b["episode_id"]), done)

    def open_episode(self):
        b = self.project.buzz
        if b.get("episode_id"):
            Gtk.UriLauncher.new(buzzsprout.episode_url(b["podcast_id"], b["episode_id"])).launch(self.win, None, None, None)
