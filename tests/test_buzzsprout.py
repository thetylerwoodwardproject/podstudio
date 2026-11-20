import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from podstudio import buzzsprout as bz

TOKEN = "tok_secret_123"


class Mock(BaseHTTPRequestHandler):
    log: list = []
    state: dict = {}

    def log_message(self, *a):
        pass

    def _send(self, code, body=None, headers=None, raw=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else b"")
        self.send_response(code)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        S = self.state
        S["calls"].append((self.command, self.path, dict(self.headers), body))
        path, m = self.path, self.command
        if path == "/blob/abc" and m == "PUT":
            S["put_len"] = len(body)
            return self._send(200)
        if self.headers.get("Authorization") != f"Token token={TOKEN}":
            return self._send(401, raw=b"HTTP Token: Access denied.")
        if S.get("flaky", 0) > 0 and path == "/api/podcasts":
            S["flaky"] -= 1
            return self._send(429, {"error": {"code": "rate_limited", "message": "slow down"}}, {"Retry-After": "1"})
        if path == "/api/redirect":
            return self._send(302, headers={"Location": "http://127.0.0.2:1/steal"})
        if path == "/api/podcasts":
            return self._send(200, [{"id": 7, "title": "Test Show", "contact_email": "owner@example.com", "rss_url": "x"}])
        if path == "/api/7/episodes" and m == "POST":
            req = json.loads(body)
            if not req.get("title"):
                return self._send(400, {"title": ["can't be blank"]})
            return self._send(201, {"id": 99, "title": req["title"], "private": req["private"], "duration": -1})
        if path == "/api/7/episodes/99/uploads" and m == "POST":
            req = json.loads(body)
            return self._send(201, {"upload": {"id": "up/1", "multipart": False,
                                               "upload_url": S.get("upload_url", f"http://127.0.0.1:{self.server.server_port}/blob/abc")}})
        if path == "/api/7/episodes/99/uploads/up%2F1/complete" and m == "POST":
            return self._send(200, {"id": 99, "duration": -1})
        if path.startswith("/api/7/episodes/99/uploads/") and path.endswith("/abort"):
            return self._send(204)
        if path == "/api/7/episodes/99" and m == "GET":
            S["polls"] = S.get("polls", 0) + 1
            return self._send(200, {"id": 99, "duration": -1 if S["polls"] < 3 else 1236})
        if path == "/api/7/episodes/99" and m == "PATCH":
            if "multipart/form-data" in (self.headers.get("Content-Type") or ""):
                S["multipart"] = (self.headers.get("Content-Type"), body)
                return self._send(200, {"id": 99, "artwork_url": "https://example.com/a.png"})
            return self._send(200, {"id": 99, **json.loads(body)})
        if path == "/api/7/episodes/99/chapters" and m == "PUT":
            req = json.loads(body)
            if not isinstance(req.get("chapters"), list):
                return self._send(422, {"error": {"code": "invalid", "message": "chapters must be an array", "param": "chapters"}})
            return self._send(200, [{"id": i, "title": c["title"], "start_time": c["start_time"], "url": c.get("url")}
                                    for i, c in enumerate(req["chapters"], 1)])
        if path == "/api/7/episodes/99/chapters" and m == "GET":
            return self._send(200, [{"id": 1, "title": "Intro", "start_time": "00:00:00", "url": None}])
        return self._send(404, {"error": {"code": "not_found", "message": "nope"}})

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _handle


@pytest.fixture
def server():
    Mock.state = {"calls": []}
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Mock)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv, Mock.state
    srv.shutdown()


def client(srv, token=TOKEN):
    return bz.Client(token, base=f"http://127.0.0.1:{srv.server_port}", sleep=lambda s: None)


def test_auth_header_user_agent_and_podcast_list(server):
    srv, S = server
    pods = client(srv).podcasts()
    assert pods == [{"id": 7, "title": "Test Show"}]                    # contact details are dropped
    _, _, headers, _ = S["calls"][0]
    assert headers["Authorization"] == f"Token token={TOKEN}"
    assert headers["User-Agent"].startswith("PodStudio/") and "@" not in headers["User-Agent"]


def test_episode_is_always_private_and_full_upload_flow(server, tmp_path):
    srv, S = server
    mp3 = tmp_path / "episode.mp3"
    mp3.write_bytes(b"ID3" + bytes(range(256)) * 40)
    c, sent = client(srv), []
    ep = c.create_episode(7, "Pilot", description="hello", explicit=False, episode_number=None, tags="")
    assert ep["private"] is True
    create = json.loads([x for x in S["calls"] if x[0] == "POST" and x[1] == "/api/7/episodes"][0][3])
    assert create == {"description": "hello", "explicit": False, "title": "Pilot", "private": True}   # blanks dropped
    c.upload_audio(7, 99, mp3, progress=lambda a, b: sent.append((a, b)))
    order = [(m, p) for m, p, *_ in S["calls"]]
    assert order[-3:] == [("POST", "/api/7/episodes/99/uploads"), ("PUT", "/blob/abc"),
                          ("POST", "/api/7/episodes/99/uploads/up%2F1/complete")]
    start = json.loads(S["calls"][-3][3])
    assert start == {"filename": "episode.mp3", "type": "audio/mpeg", "byte_size": mp3.stat().st_size}
    assert S["put_len"] == mp3.stat().st_size                              # exact bytes declared
    put_headers = S["calls"][-2][2]
    assert "Authorization" not in put_headers                              # token never goes to the storage host
    assert sent and sent[-1] == (mp3.stat().st_size, mp3.stat().st_size)


def test_failed_put_aborts_the_upload(server, tmp_path):
    srv, S = server
    S["upload_url"] = f"http://127.0.0.1:{srv.server_port}/blob/missing"       # the mock answers 401 for this path
    mp3 = tmp_path / "e.mp3"
    mp3.write_bytes(b"x" * 1000)
    with pytest.raises(bz.BuzzsproutError):
        client(srv).upload_audio(7, 99, mp3)
    assert any(m == "DELETE" and p.endswith("/abort") for m, p, *_ in S["calls"])


def test_refuses_insecure_upload_url_for_the_real_host(tmp_path):
    c = bz.Client(TOKEN)                                                       # real base URL
    with pytest.raises(bz.BuzzsproutError, match="insecure"):
        c._check_upload_url("http://evil.example/blob")
    c._check_upload_url("https://uploads.example.com/blob")


def test_wait_until_encoded_polls(server):
    srv, S = server
    ep = client(srv).wait_until_encoded(7, 99, poll=1)
    assert ep["duration"] == 1236 and S["polls"] == 3


def test_publish_is_a_separate_explicit_call(server):
    srv, S = server
    c = client(srv)
    c.create_episode(7, "Pilot")
    assert not any(json.loads(b or b"{}").get("private") is False for m, p, h, b in S["calls"] if m == "POST")
    assert c.publish(7, 99, explicit=True)["private"] is False
    assert c.unpublish(7, 99, explicit=False)["private"] is True
    patches = [json.loads(b) for m, p, h, b in S["calls"] if m == "PATCH"]
    assert patches == [{"private": False, "explicit": True}, {"private": True, "explicit": False}]   # explicit is never dropped


def test_errors_are_readable(server):
    srv, S = server
    with pytest.raises(bz.BuzzsproutError) as e:
        client(srv, "wrong").podcasts()
    assert e.value.status == 401 and "token" in str(e.value).lower()
    with pytest.raises(bz.BuzzsproutError) as e:
        client(srv).create_episode(7, "")
    assert e.value.status == 400 and "title" in str(e.value)               # legacy field-hash format


def test_retries_rate_limits_but_not_creates(server):
    srv, S = server
    S["flaky"] = 2
    assert client(srv).podcasts()[0]["id"] == 7                            # 429, 429, then success
    assert sum(1 for m, p, *_ in S["calls"] if p == "/api/podcasts") == 3


def test_redirects_are_not_followed(server):
    srv, S = server
    with pytest.raises(bz.BuzzsproutError):
        client(srv)._call("GET", "/api/redirect")
    assert not any("steal" in p for m, p, *_ in S["calls"])                # the token never left


def test_token_is_never_in_repr_or_errors():
    c = bz.Client(TOKEN)
    assert TOKEN not in repr(c)
    with pytest.raises(bz.BuzzsproutError):
        bz.Client("   ")


def test_artwork_is_sent_as_multipart_and_keeps_the_explicit_flag(server, tmp_path):
    srv, S = server
    img = tmp_path / "cover.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 500)
    client(srv).set_artwork(7, 99, img, explicit=True)
    ctype, body = S["multipart"]
    assert ctype.startswith("multipart/form-data; boundary=")
    assert b'name="artwork_file"; filename="cover.png"' in body and b"Content-Type: image/png" in body
    assert b'name="explicit"\r\n\r\ntrue' in body                           # not reset to false by the update
    assert b"\x89PNG" in body


def test_artwork_size_limit(server, tmp_path, monkeypatch):
    srv, S = server
    monkeypatch.setattr(bz, "MAX_ART_BYTES", 100)
    big = tmp_path / "big.jpg"
    big.write_bytes(b"x" * 500)
    with pytest.raises(bz.BuzzsproutError, match="limit"):
        client(srv).set_artwork(7, 99, big, explicit=False)


def test_chapters_replace_with_hms_times(server):
    srv, S = server
    out = client(srv).put_chapters(7, 99, [{"t": 0, "title": "Intro"}, {"t": 95.7, "title": "Main", "url": "https://x.example"},
                                           {"t": 3725, "title": "Outro"}])
    sent = json.loads([b for m, p, h, b in S["calls"] if m == "PUT" and p.endswith("/chapters")][0])
    assert sent == {"chapters": [{"title": "Intro", "start_time": "00:00:00"},
                                 {"title": "Main", "start_time": "00:01:35", "url": "https://x.example"},
                                 {"title": "Outro", "start_time": "01:02:05"}]}
    assert [c["title"] for c in out] == ["Intro", "Main", "Outro"]
    assert client(srv).get_chapters(7, 99)[0]["title"] == "Intro"
    assert bz.format_hms(3599.9) == "00:59:59"
