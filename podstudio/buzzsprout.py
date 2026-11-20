"""Buzzsprout API client (https://github.com/Buzzsprout/buzzsprout-api). Standard library only.

Publish flow, as documented by Buzzsprout:
  create a private episode -> start upload -> PUT the file bytes (no Authorization header) -> complete upload
  -> wait for encoding -> (optionally) PATCH the episode to make it public.

PodStudio only ever creates private drafts. Going public is a separate explicit call: publish().
"""
from __future__ import annotations

import json
import mimetypes
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from . import __version__

API = "https://www.buzzsprout.com"
# Buzzsprout asks for an identifiable User-Agent. This one names the app only, nothing about the user.
USER_AGENT = f"PodStudio/{__version__} (Linux desktop app)"
RETRY_STATUSES = (429, 500, 502, 503, 504)
MAX_ART_BYTES = 20 * 1000 * 1000


class BuzzsproutError(Exception):
    def __init__(self, message: str, status: int = 0, code: str = "", param: str = ""):
        super().__init__(message)
        self.status, self.code, self.param = status, code, param


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow redirects: urllib would carry the Authorization header to wherever they point."""

    def redirect_request(self, *a, **k):
        return None


class _Progress:
    """File-like body that reports bytes sent, so a big upload can drive a progress bar."""

    def __init__(self, path: Path, callback):
        self._f, self._cb, self.sent, self.size = open(path, "rb"), callback, 0, os.path.getsize(path)

    def read(self, n=-1):
        chunk = self._f.read(n if n and n > 0 else 1 << 20)
        self.sent += len(chunk)
        if self._cb and chunk:
            self._cb(self.sent, self.size)
        return chunk

    def close(self):
        self._f.close()


def _parse_error(status: int, raw: bytes) -> BuzzsproutError:
    text = raw.decode("utf-8", "replace").strip()
    try:
        data = json.loads(text)
    except ValueError:
        data = None
    if isinstance(data, dict) and isinstance(data.get("error"), dict):          # current format
        e = data["error"]
        return BuzzsproutError(e.get("message") or text, status, e.get("code", ""), e.get("param", ""))
    if isinstance(data, dict):                                                  # legacy: {"title": ["can't be blank"]}
        parts = [f"{k} {', '.join(v) if isinstance(v, list) else v}" for k, v in data.items()]
        return BuzzsproutError("; ".join(parts) or f"HTTP {status}", status, "invalid", next(iter(data), ""))
    if status in (401, 403):
        return BuzzsproutError("Buzzsprout rejected the API token.", status, "unauthorized")
    return BuzzsproutError(text[:200] or f"HTTP {status}", status)


class Client:
    def __init__(self, token: str, base: str = API, user_agent: str = USER_AGENT, sleep=time.sleep):
        if not token or not token.strip():
            raise BuzzsproutError("No API token.")
        self._token, self.base, self.user_agent, self._sleep = token.strip(), base.rstrip("/"), user_agent, sleep
        self._opener = urllib.request.build_opener(_NoRedirect)

    def __repr__(self):                                   # never print the token
        return f"Client(base={self.base!r})"

    # -- plumbing
    def _call(self, method: str, path: str, body=None, retry: bool = True):
        data, ctype = None, None
        if body is not None:
            data, ctype = json.dumps(body).encode("utf-8"), "application/json; charset=utf-8"
        return self._send(method, path, data, ctype, retry)

    def _send(self, method: str, path: str, data: bytes | None, content_type: str | None, retry: bool = True):
        url = self.base + path
        headers = {"Authorization": f"Token token={self._token}", "User-Agent": self.user_agent,
                   "Accept": "application/json"}
        if content_type:
            headers["Content-Type"] = content_type
        attempts = 4 if retry else 1
        for attempt in range(attempts):
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with self._opener.open(req, timeout=120) as r:
                    raw = r.read()
                    return json.loads(raw) if raw.strip() else None
            except urllib.error.HTTPError as e:
                raw = e.read()
                if e.code in RETRY_STATUSES and attempt < attempts - 1:
                    wait = e.headers.get("Retry-After")
                    self._sleep(min(float(wait), 60) if wait and wait.replace(".", "").isdigit() else 2 ** attempt)
                    continue
                raise _parse_error(e.code, raw) from None
            except urllib.error.URLError as e:
                if attempt < attempts - 1:
                    self._sleep(2 ** attempt)
                    continue
                raise BuzzsproutError(f"Couldn't reach Buzzsprout: {e.reason}") from None

    # -- podcasts
    def podcasts(self) -> list[dict]:
        """Just what the app needs. The API also returns contact details, which we never keep."""
        return [{"id": p["id"], "title": p.get("title", str(p["id"]))} for p in (self._call("GET", "/api/podcasts") or [])]

    # -- episodes
    def create_episode(self, podcast_id: int, title: str, **fields) -> dict:
        """Create an episode. Always private: it cannot be public until publish() is called."""
        body = {k: v for k, v in fields.items() if v not in (None, "")}
        body.update(title=title, private=True)
        return self._call("POST", f"/api/{int(podcast_id)}/episodes", body, retry=False)   # no blind retry: could duplicate

    def episode(self, podcast_id: int, episode_id: int) -> dict:
        return self._call("GET", f"/api/{int(podcast_id)}/episodes/{int(episode_id)}")

    def update_episode(self, podcast_id: int, episode_id: int, **fields) -> dict:
        return self._call("PATCH", f"/api/{int(podcast_id)}/episodes/{int(episode_id)}", fields)

    def publish(self, podcast_id: int, episode_id: int, *, explicit: bool) -> dict:
        """Make the episode public. Only call this after the user confirmed.

        `explicit` is required because Buzzsprout treats an omitted value on update as false, which would
        silently clear the flag on an explicit episode."""
        return self.update_episode(podcast_id, episode_id, private=False, explicit=bool(explicit))

    def unpublish(self, podcast_id: int, episode_id: int, *, explicit: bool) -> dict:
        return self.update_episode(podcast_id, episode_id, private=True, explicit=bool(explicit))

    # -- artwork
    def set_artwork(self, podcast_id: int, episode_id: int, path: Path, *, explicit: bool) -> dict:
        """Upload episode cover art (multipart `artwork_file`). `explicit` is resent for the same reason as above."""
        path = Path(path)
        size = path.stat().st_size
        if size > MAX_ART_BYTES:
            raise BuzzsproutError(f"Artwork is {size / 1e6:.0f} MB; the limit here is {MAX_ART_BYTES // 1_000_000} MB.")
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        boundary = "----podstudio" + secrets.token_hex(12)
        parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="explicit"\r\n\r\n{"true" if explicit else "false"}\r\n'.encode(),
                 (f'--{boundary}\r\nContent-Disposition: form-data; name="artwork_file"; filename="{path.name}"\r\n'
                  f"Content-Type: {ctype}\r\n\r\n").encode(), path.read_bytes(), b"\r\n",
                 f"--{boundary}--\r\n".encode()]
        return self._send("PATCH", f"/api/{int(podcast_id)}/episodes/{int(episode_id)}", b"".join(parts),
                          f"multipart/form-data; boundary={boundary}", retry=True)

    # -- chapters
    def get_chapters(self, podcast_id: int, episode_id: int) -> list[dict]:
        return self._call("GET", f"/api/{int(podcast_id)}/episodes/{int(episode_id)}/chapters") or []

    def put_chapters(self, podcast_id: int, episode_id: int, chapters: list[dict]) -> list[dict]:
        """Replace the episode's whole chapter list. chapters: [{"t": seconds, "title": str, "url": optional}]."""
        body = []
        for c in chapters:
            item = {"title": c["title"], "start_time": format_hms(c["t"])}
            if c.get("url"):
                item["url"] = c["url"]
            body.append(item)
        return self._call("PUT", f"/api/{int(podcast_id)}/episodes/{int(episode_id)}/chapters", {"chapters": body}) or []

    # -- media
    def upload_audio(self, podcast_id: int, episode_id: int, path: Path, progress=None,
                     content_type: str = "audio/mpeg") -> dict:
        """start -> PUT bytes -> complete. Aborts the upload if the PUT fails. Files up to 5 GiB (single PUT)."""
        path = Path(path)
        size = path.stat().st_size
        if size > 5 * 1024 ** 3:
            raise BuzzsproutError("File is over 5 GiB.")
        base = f"/api/{int(podcast_id)}/episodes/{int(episode_id)}/uploads"
        up = (self._call("POST", base, {"filename": path.name, "type": content_type, "byte_size": size}) or {}).get("upload") or {}
        upload_id, url = up.get("id"), up.get("upload_url")
        if not upload_id or not url:
            raise BuzzsproutError("Buzzsprout didn't return an upload URL.")
        self._check_upload_url(url)
        try:
            self._put(url, path, size, content_type, progress)
        except BaseException:
            try:
                self._call("DELETE", f"{base}/{urllib.parse.quote(str(upload_id), safe='')}/abort", retry=False)
            except BuzzsproutError:
                pass
            raise
        return self._call("POST", f"{base}/{urllib.parse.quote(str(upload_id), safe='')}/complete", retry=False)

    def _check_upload_url(self, url: str):
        parts = urllib.parse.urlparse(url)
        local_test = self.base.startswith("http://127.0.0.1") and parts.hostname == "127.0.0.1"
        if parts.scheme != "https" and not local_test:
            raise BuzzsproutError("Refusing to upload over an insecure connection.")

    def _put(self, url, path, size, content_type, progress):
        body = _Progress(path, progress)
        # Deliberately a bare request: no Authorization header goes to the storage host.
        req = urllib.request.Request(url, data=body, method="PUT",
                                     headers={"Content-Length": str(size), "Content-Type": content_type,
                                              "User-Agent": self.user_agent})
        try:
            with self._opener.open(req, timeout=600) as r:
                r.read()
        except urllib.error.HTTPError as e:
            raise BuzzsproutError(f"Upload failed ({e.code}).", e.code, "upload_failed") from None
        except urllib.error.URLError as e:
            raise BuzzsproutError(f"Upload failed: {e.reason}") from None
        finally:
            body.close()

    def wait_until_encoded(self, podcast_id: int, episode_id: int, timeout: float = 1800, poll: float = 5,
                           on_poll=None) -> dict:
        """Poll until Buzzsprout finishes encoding (duration is no longer -1). 60 requests/min is the limit."""
        end = time.monotonic() + timeout
        while True:
            ep = self.episode(podcast_id, episode_id)
            if on_poll:
                on_poll(ep)
            if (ep.get("duration") or -1) > 0:
                return ep
            if time.monotonic() > end:
                raise BuzzsproutError("Buzzsprout is still encoding. Check the episode on buzzsprout.com.")
            self._sleep(max(poll, 1.0))


def format_hms(seconds: float) -> str:
    s = max(0, int(seconds))
    return f"{s // 3600:02d}:{(s // 60) % 60:02d}:{s % 60:02d}"


def episode_url(podcast_id: int, episode_id: int) -> str:
    return f"https://www.buzzsprout.com/{int(podcast_id)}/episodes/{int(episode_id)}"
