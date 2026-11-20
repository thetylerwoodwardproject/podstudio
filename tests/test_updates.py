import hashlib
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from podstudio import updates as up

DEB = b"!<arch>\ndebian-binary   fake package bytes " + bytes(range(256)) * 100
DEB_SHA = hashlib.sha256(DEB).hexdigest()
NAME = "podstudio_2026.12.05_amd64.deb"


class Rel(BaseHTTPRequestHandler):
    state: dict = {}

    def log_message(self, *a):
        pass

    def _send(self, code, body=b"", headers=None):
        self.send_response(code)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        S, port = self.state, self.server.server_port
        S.setdefault("hits", []).append((self.path, self.headers.get("User-Agent"), self.headers.get("Authorization")))
        if self.path == "/repos/o/r/releases/latest":
            if S.get("status"):
                return self._send(S["status"])
            base = f"http://127.0.0.1:{port}"
            assets = [{"name": NAME, "size": len(DEB), "browser_download_url": f"{base}/dl/{NAME}"}]
            if not S.get("no_sha"):
                assets.append({"name": NAME + ".sha256", "size": 90, "browser_download_url": f"{base}/dl/{NAME}.sha256"})
            rel = {"tag_name": S.get("tag", "v2026.12.05"), "body": "Adds a thing.", "html_url": "https://github.com/o/r/releases/tag/x",
                   "assets": assets, "prerelease": S.get("pre", False), "draft": False}
            return self._send(200, json.dumps(rel).encode())
        if self.path == f"/dl/{NAME}":
            return self._send(200, S.get("deb", DEB))
        if self.path == f"/dl/{NAME}.sha256":
            return self._send(200, f"{S.get('sha', DEB_SHA)}  {NAME}\n".encode())
        if self.path == "/dl/redirect":
            return self._send(302, headers={"Location": "http://evil.invalid/steal.deb"})
        self._send(404)


@pytest.fixture
def server():
    Rel.state = {}
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Rel)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}", Rel.state
    srv.shutdown()


# ------------------------------------------------------------------ versions
def test_calendar_versions_compare_correctly():
    assert up.is_newer("v2026.12.05", "2026.11.20") and up.is_newer("2026.11.21", "2026.11.20")
    assert up.is_newer("2026.11.20-3", "2026.11.20-2") and up.is_newer("2026.11.20-2", "2026.11.20")
    assert not up.is_newer("2026.11.20", "2026.11.20") and not up.is_newer("2026.11.19", "2026.11.20")
    assert not up.is_newer("2026.11.20", "2026.11.20-3")          # an older revision is not an update
    assert up.is_newer("2027.01.02", "2026.12.31")
    assert up.version_key("v2026.11") == (2026, 11, 0, 0)
    assert up.version_key("not-a-version") is None and not up.is_newer("latest", "2026.11.20")


def test_checks_are_throttled_to_once_a_day():
    assert up.should_check(0, 1000) and not up.should_check(1000, 1000 + 3600)
    assert up.should_check(1000, 1000 + up.CHECK_INTERVAL + 1)


# ------------------------------------------------------------------ lookup
def test_newer_release_is_found_and_the_request_is_anonymous(server):
    base, S = server
    info = up.check("2026.11.20", base=base, repo="o/r")
    assert info.version == "2026.12.05" and info.can_install and info.deb_name == NAME and info.notes == "Adds a thing."
    path, ua, auth = S["hits"][0]
    assert ua.startswith("PodStudio/") and "@" not in ua and auth is None          # nothing identifying, no credentials


def test_no_update_when_current_or_newer_or_unreleased(server):
    base, S = server
    assert up.check("2026.12.05", base=base, repo="o/r") is None
    assert up.check("2027.01.01", base=base, repo="o/r") is None
    S["status"] = 404                                                               # a project with no releases yet
    assert up.check("2026.11.20", base=base, repo="o/r") is None
    S.pop("status"); S["pre"] = True
    assert up.check("2026.11.20", base=base, repo="o/r") is None                    # pre-releases are not offered


def test_errors_are_reported_not_raised_as_surprises(server):
    base, S = server
    S["status"] = 500
    with pytest.raises(up.UpdateError, match="500"):
        up.check("2026.11.20", base=base, repo="o/r")
    with pytest.raises(up.UpdateError, match="reach"):
        up.check("2026.11.20", base="http://127.0.0.1:1", repo="o/r", timeout=2)


def test_a_release_without_a_checksum_is_not_auto_installable(server):
    base, S = server
    S["no_sha"] = True
    info = up.check("2026.11.20", base=base, repo="o/r")
    assert not info.can_install and "checksum" in info.problems[0] and info.page.startswith("https://github.com/")
    with pytest.raises(up.UpdateError, match="checksum"):
        up.download(info, base=base)


# ------------------------------------------------------------------ download and verify
def test_download_verifies_the_checksum_and_reports_progress(server, tmp_path):
    base, S = server
    info = up.check("2026.11.20", base=base, repo="o/r")
    seen = []
    f = up.download(info, progress=lambda a, b: seen.append((a, b)), base=base, cache=tmp_path)
    assert f == tmp_path / NAME and f.read_bytes() == DEB and seen[-1][0] == len(DEB)
    assert not list(tmp_path.glob("*.part"))


def test_a_download_that_does_not_match_is_discarded(server, tmp_path):
    base, S = server
    info = up.check("2026.11.20", base=base, repo="o/r")
    S["deb"] = DEB + b"tampered"
    with pytest.raises(up.UpdateError, match="checksum"):
        up.download(info, base=base, cache=tmp_path)
    assert list(tmp_path.iterdir()) == []                                          # nothing left to install by accident


def test_checksum_parsing_is_strict():
    h = "a" * 64
    assert up.parse_checksum(f"{h}  {NAME}\n", NAME) == h
    assert up.parse_checksum(f"{h}\n", NAME) == h
    with pytest.raises(up.UpdateError):
        up.parse_checksum(f"{h}  some_other_file.deb\n", NAME)                      # a checksum for a different file
    with pytest.raises(up.UpdateError):
        up.parse_checksum("not a checksum", NAME)


def test_untrusted_hosts_and_redirects_are_refused(server, tmp_path):
    base, S = server
    info = up.check("2026.11.20", base=base, repo="o/r")
    info.deb_url = "https://evil.example.com/podstudio.deb"
    with pytest.raises(up.UpdateError, match="untrusted"):
        up.download(info, base=base, cache=tmp_path)
    with pytest.raises(up.UpdateError, match="redirect"):
        up._fetch(f"{base}/dl/redirect", base)
    assert not up._host_ok("http://github.com/x") and up._host_ok("https://github.com/x/y")
    assert up._host_ok("https://objects.githubusercontent.com/z") and not up._host_ok("https://github.com.evil.io/z")


# ------------------------------------------------------------------ install
def test_install_only_accepts_a_package_from_our_cache(tmp_path):
    ok = tmp_path / NAME
    ok.write_bytes(b"x")
    assert up.install_command(ok, cache=tmp_path) == ["pkexec", "apt-get", "install", "-y", str(ok)]
    for bad in (tmp_path / "evil.deb", tmp_path / "podstudio_1.0_arm64.deb", tmp_path / "x" / NAME, ok.parent.parent / NAME):
        with pytest.raises(up.UpdateError):
            up.install_command(bad, cache=tmp_path)
    inj = tmp_path / "podstudio_1.0_amd64.deb; rm -rf ~"
    with pytest.raises(up.UpdateError):
        up.install_command(inj, cache=tmp_path)


def test_install_failures_come_with_advice(tmp_path, monkeypatch):
    import subprocess
    f = tmp_path / NAME
    f.write_bytes(b"x")
    monkeypatch.setattr(up.shutil, "which", lambda n: "/usr/bin/pkexec")
    run = lambda code, err="": (lambda *a, **k: subprocess.CompletedProcess(a, code, stdout="", stderr=err))
    monkeypatch.setattr(up.subprocess, "run", run(126))
    with pytest.raises(up.UpdateError, match="wasn't authorized"):
        up.install(f, cache=tmp_path)
    monkeypatch.setattr(up.subprocess, "run", run(100, "E: dependency problem"))
    with pytest.raises(up.UpdateError, match="dependency problem.*sudo apt install"):
        up.install(f, cache=tmp_path)
    monkeypatch.setattr(up.subprocess, "run", run(0))
    assert up.install(f, cache=tmp_path) == "Installed."
    monkeypatch.setattr(up.shutil, "which", lambda n: None)
    with pytest.raises(up.UpdateError, match="sudo apt install"):
        up.install(f, cache=tmp_path)
