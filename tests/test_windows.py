"""Windows support, checked from Linux.

Nothing here touches Windows itself. These tests pin down the logic that is separate from the operating system: how the
Windows build is recognised, what environment it sets up, how the HID and audio-gain code behave against fakes, and that
the updater picks and validates the installer. What cannot be checked this way (a real PodMic on a real Windows machine,
the GTK stack bundled by MSYS2) is listed in packaging/windows/README.md.
"""
import ctypes
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest

from podstudio import hidapi, podmic, runtime, updates, winaudio, winenv

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def windows(monkeypatch, tmp_path):
    """Pretend to be the installed Windows build, rooted at tmp_path."""
    for k in ("FLATPAK_ID", "APPIMAGE", "APPDIR"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(runtime, "IS_WINDOWS", True)
    monkeypatch.setenv("PODSTUDIO_HOME", str(tmp_path))
    return tmp_path


# ------------------------------------------------------------------ which build is running
def test_the_windows_build_is_recognised_by_the_launchers_variable(windows):
    assert runtime.kind() == "windows" and runtime.updates_enabled() and not runtime.sandboxed()
    assert runtime.describe() == "the Windows build"


def test_a_source_checkout_on_windows_is_still_source(monkeypatch):
    monkeypatch.delenv("PODSTUDIO_HOME", raising=False)
    monkeypatch.setattr(runtime, "IS_WINDOWS", True)
    assert runtime.kind() == "source"


def test_podstudio_home_is_ignored_off_windows(monkeypatch, tmp_path):
    monkeypatch.setenv("PODSTUDIO_HOME", str(tmp_path))
    monkeypatch.setattr(runtime, "IS_WINDOWS", False)
    assert runtime.windows_home() is None and runtime.kind() != "windows"


def test_bundled_tools_are_found_in_the_install_folder_with_an_exe_suffix(windows):
    (windows / "bin").mkdir()
    exe = windows / "bin" / "deep-filter.exe"
    exe.write_bytes(b"MZ")
    assert runtime.bundled("bin", "deep-filter") == exe
    assert runtime.bundled("bin", "nothing-here") is None


def test_noise_reduction_finds_the_bundled_exe(windows, monkeypatch):
    pytest.importorskip("soundfile")
    from podstudio import denoise
    (windows / "bin").mkdir()
    exe = windows / "bin" / "deep-filter.exe"
    exe.write_bytes(b"MZ")
    exe.chmod(0o755)
    monkeypatch.delenv("PODSTUDIO_DEEPFILTER", raising=False)
    assert denoise.find_binary() == exe


# ------------------------------------------------------------------ environment for the bundled GTK and GStreamer
def test_the_environment_points_at_the_install_and_uses_a_writable_registry(tmp_path):
    home, cache = tmp_path / "PodStudio", tmp_path / "cache"
    env = winenv.environment(home, cache)
    assert env["GI_TYPELIB_PATH"] == str(home / "lib" / "girepository-1.0")
    assert env["GST_PLUGIN_PATH"] == env["GST_PLUGIN_SYSTEM_PATH"] == str(home / "lib" / "gstreamer-1.0")
    assert env["GST_REGISTRY_1_0"].startswith(str(cache))               # the install folder may be read-only
    assert "GST_PLUGIN_SCANNER" not in env and "SSL_CERT_FILE" not in env   # only when those files are bundled


def test_optional_files_are_used_when_they_are_bundled(tmp_path):
    home = tmp_path / "PodStudio"
    (home / "libexec" / "gstreamer-1.0").mkdir(parents=True)
    (home / "libexec" / "gstreamer-1.0" / "gst-plugin-scanner.exe").write_bytes(b"MZ")
    (home / "ssl").mkdir()
    (home / "ssl" / "cacert.pem").write_text("x")
    env = winenv.environment(home, tmp_path)
    assert env["GST_PLUGIN_SCANNER"].endswith("gst-plugin-scanner.exe") and env["SSL_CERT_FILE"].endswith("cacert.pem")


def test_prepare_does_nothing_off_windows(monkeypatch, tmp_path):
    import os
    monkeypatch.setattr(winenv.sys, "platform", "linux")           # (a real Windows runner would otherwise run it)
    monkeypatch.setenv("PODSTUDIO_HOME", str(tmp_path))
    monkeypatch.delenv("GI_TYPELIB_PATH", raising=False)
    winenv.prepare()
    assert "GI_TYPELIB_PATH" not in os.environ


# ------------------------------------------------------------------ gst-launch quoting and elements (needs GStreamer)
def test_windows_paths_are_safe_inside_a_pipeline_description(monkeypatch):
    audio = pytest.importorskip("podstudio.audio", exc_type=ImportError)
    monkeypatch.setattr(runtime, "IS_WINDOWS", True)
    assert audio._loc(r"C:\Users\Ann\Music\PodStudio\mic.wav") == "C:/Users/Ann/Music/PodStudio/mic.wav"
    assert audio._loc('a"b') == 'a\\"b'
    assert audio.default_sink() == "autoaudiosink"
    monkeypatch.setattr(runtime, "IS_WINDOWS", False)
    assert audio._loc("/home/a/mic.wav") == "/home/a/mic.wav" and audio.default_sink() == "pulsesink"


def test_capture_pipeline_per_platform(monkeypatch):
    audio = pytest.importorskip("podstudio.audio", exc_type=ImportError)
    monkeypatch.setattr(runtime, "IS_WINDOWS", False)
    assert audio._capture("alsa_input.usb-podmic").startswith("pulsesrc device=alsa_input.usb-podmic ")
    monkeypatch.setattr(runtime, "IS_WINDOWS", True)
    win = audio._capture("{0.0.1.00000000}.{abc}")
    assert win.startswith(("wasapi2src", "wasapisrc")) and 'device="{0.0.1.00000000}.{abc}"' in win
    assert "audioresample" in win and "rate=48000,channels=1" in win


# ------------------------------------------------------------------ HID transport
class FakeIO:
    """Stands in for the HID interface: remembers writes and answers like a PodMic that has a value to report."""

    def __init__(self, answer=True):
        self.sent, self.queue, self.closed, self.answer = [], [], False, answer

    def drain(self):
        self.queue.clear()

    def write(self, data):
        self.sent.append(bytes(data))
        if self.answer:
            self.queue.append(bytes([podmic.REPLY[data[0]], 0, ord("A"), 1, 0, 0]))

    def read(self, timeout):
        return self.queue.pop(0) if self.queue else None

    def close(self):
        self.closed = True


def test_a_request_goes_through_the_transport_and_the_reply_is_decoded():
    m = podmic.PodMic(path="x")
    m._io = FakeIO()
    assert m.hpf() is True
    assert m._io.sent[0][:4] == bytes([podmic.R_PARAM, podmic.P_HPF, podmic.P_GET, 0])


def test_no_reply_is_a_timeout_not_a_hang():
    m = podmic.PodMic(path="x")
    m._io = FakeIO(answer=False)
    with pytest.raises(podmic.PodMicError, match="timeout"):
        m._xfer(podmic.param_report(podmic.P_HPF, podmic.P_GET), timeout=0.05)


def test_using_a_closed_mic_is_an_error():
    m = podmic.PodMic(path="x")
    with pytest.raises(podmic.PodMicError, match="not open"):
        m.hpf()


def test_windows_open_uses_the_first_interface_that_answers(monkeypatch):
    monkeypatch.setattr(runtime, "IS_WINDOWS", True)
    monkeypatch.setattr(podmic, "hid_candidates", lambda: [b"keys", b"control", b"other"])
    opened = {}

    def fake_hidapi(path):
        opened[path] = FakeIO(answer=(path == b"control"))
        return opened[path]

    monkeypatch.setattr(podmic, "_Hidapi", fake_hidapi)
    m = podmic.PodMic(path=b"keys")
    m.open()
    assert m.path == b"control" and m._io is opened[b"control"]
    assert opened[b"keys"].closed and b"other" not in opened          # the silent one was closed; the rest never opened


def test_windows_open_fails_cleanly_when_nothing_answers(monkeypatch):
    monkeypatch.setattr(runtime, "IS_WINDOWS", True)
    monkeypatch.setattr(podmic, "hid_candidates", lambda: [b"a"])
    monkeypatch.setattr(podmic, "_Hidapi", lambda path: FakeIO(answer=False))
    monkeypatch.setattr(podmic.time, "monotonic", iter(range(0, 1000, 2)).__next__)   # skip the 1 s wait
    with pytest.raises(podmic.PodMicError):
        podmic.PodMic(path=b"a").open()


def test_vendor_defined_interfaces_are_tried_first(monkeypatch):
    infos = [hidapi.DeviceInfo(b"consumer", 0x19F7, 0x4A, 0x0C, 1, 0),
             hidapi.DeviceInfo(b"vendor", 0x19F7, 0x4A, 0xFF00, 1, 3),
             hidapi.DeviceInfo(b"keyboard", 0x19F7, 0x4A, 0x01, 6, 1)]
    monkeypatch.setattr(hidapi, "enumerate_devices", lambda v, p: infos)
    assert podmic.hid_candidates() == [b"vendor", b"consumer", b"keyboard"]


def test_a_missing_hidapi_means_no_candidates_not_a_crash(monkeypatch):
    def boom(v, p):
        raise hidapi.HidError("not found")
    monkeypatch.setattr(hidapi, "enumerate_devices", boom)
    assert podmic.hid_candidates() == []
    monkeypatch.setattr(runtime, "IS_WINDOWS", True)
    assert podmic.find_hidraw() is None and podmic.PodMic.present() is False


def test_enumeration_walks_the_linked_list_and_frees_it():
    a, b = hidapi._Info(), hidapi._Info()
    a.path, a.vendor_id, a.product_id, a.usage_page, a.usage, a.interface_number = b"first", 0x19F7, 0x4A, 0xFF00, 2, 1
    b.path, b.vendor_id, b.product_id, b.usage_page, b.usage, b.interface_number = b"second", 0x19F7, 0x4A, 0x0C, 1, 0
    a.next = ctypes.pointer(b)

    class Lib:
        freed = None

        def hid_enumerate(self, v, p):
            assert (v, p) == (0x19F7, 0x4A)
            return ctypes.pointer(a)

        def hid_free_enumeration(self, head):
            Lib.freed = head

    hidapi._lib = Lib()
    try:
        got = hidapi.enumerate_devices(0x19F7, 0x4A)
    finally:
        hidapi._lib = None
    assert [(d.path, d.usage_page, d.interface) for d in got] == [(b"first", 0xFF00, 1), (b"second", 0x0C, 0)]
    assert Lib.freed is not None


# ------------------------------------------------------------------ input gain
def test_gain_slider_maps_onto_whatever_range_windows_reports():
    assert winaudio.to_device_db(22, -10, 20) == pytest.approx(-10)
    assert winaudio.to_device_db(63, -10, 20) == pytest.approx(20)
    assert winaudio.to_device_db(42.5, -10, 20) == pytest.approx(5)
    assert winaudio.to_ui_db(5, -10, 20) == pytest.approx(42.5)
    assert winaudio.to_device_db(99, -10, 20) == pytest.approx(20)        # out-of-range values are clamped
    assert winaudio.to_device_db(30, 22, 63) == pytest.approx(30)         # identical ranges: nothing changes
    assert winaudio.to_ui_db(30, 22, 63) == pytest.approx(30)
    assert winaudio.to_ui_db(0, 5, 5) == winaudio.UI_MIN_DB               # a degenerate range doesn't divide by zero


def test_gain_calls_on_windows_go_to_the_endpoint_not_alsa(monkeypatch):
    monkeypatch.setattr(runtime, "IS_WINDOWS", True)
    calls = []
    monkeypatch.setattr(winaudio, "get_capture_db", lambda dev: calls.append(("get", dev)) or 41.0)
    monkeypatch.setattr(winaudio, "set_capture_db", lambda dev, db: calls.append(("set", dev, db)) or True)
    assert podmic.get_gain_db("{endpoint}") == 41.0
    assert podmic.set_gain_db(80, "{endpoint}") is True                   # clamped to the slider's maximum first
    assert calls == [("get", "{endpoint}"), ("set", "{endpoint}", 63.0)]


def test_gain_reports_failure_instead_of_raising_when_com_is_unavailable():
    assert winaudio.get_capture_db("{nothing}") is None                   # no comtypes here, as on any non-Windows machine
    assert winaudio.set_capture_db("{nothing}", 40) is False


# ------------------------------------------------------------------ updater
def test_the_windows_updater_only_accepts_its_own_installer_name(monkeypatch):
    monkeypatch.setattr(runtime, "IS_WINDOWS", True)
    ok = updates.package_name_pattern().match
    assert ok("PodStudio-2026.12.05-x64-setup.exe") and ok("PodStudio-2026.12.05-3-x64-setup.exe")
    assert not ok("PodStudio-2026.12.05-x64-portable.zip") and not ok("podstudio_2026.12.05_amd64.deb")
    assert not ok("PodStudio-2026.12.05-x64-setup.exe.sha256") and not ok("PodStudio-x64-setup.exe; calc")
    monkeypatch.setattr(runtime, "IS_WINDOWS", False)
    assert updates.package_name_pattern().match("podstudio_2026.12.05_amd64.deb")
    assert not updates.package_name_pattern().match("PodStudio-2026.12.05-x64-setup.exe")


def test_asset_versions_are_read_from_either_name():
    assert updates._asset_version("podstudio_2026.11.20-3_amd64.deb") == "2026.11.20-3"
    assert updates._asset_version("PodStudio-2026.11.20-3-x64-setup.exe") == "2026.11.20-3"
    assert updates._asset_version("PodStudio-2026.11.20-x64-setup.exe") == "2026.11.20"
    assert updates._asset_version("something-else.exe") == ""


def test_installed_version_comes_from_the_version_file(windows):
    assert updates.installed_version() is None
    (windows / "VERSION").write_text("2026.11.20-7\n")
    assert updates.installed_version() == "2026.11.20-7" and updates.current_version() == "2026.11.20-7"
    assert not updates.is_newer("v2026.11.20-7", updates.current_version())        # no update offered for itself
    assert updates.is_newer("v2026.11.20-8", updates.current_version())


def test_only_an_installed_copy_installs_updates_itself(windows):
    assert not updates.can_self_install()                                          # unzipped by hand: no uninstaller
    (windows / "unins000.exe").write_bytes(b"MZ")
    assert updates.can_self_install() and updates.how_installed() == "the Windows installer"


def test_the_installer_is_started_with_the_exact_silent_arguments(windows, tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    setup = cache / "PodStudio-2026.12.05-x64-setup.exe"
    setup.write_bytes(b"MZ")
    cmd = updates.install_command(setup, cache=cache)
    assert cmd[0] == str(setup.resolve()) and "/SILENT" in cmd and "/CLOSEAPPLICATIONS" in cmd and "/RELAUNCH=1" in cmd
    assert "pkexec" not in cmd
    iss = (ROOT / "packaging" / "windows" / "podstudio.iss").read_text()
    assert "{param:RELAUNCH|0}" in iss                                              # the script reads what the updater sends


def test_the_installer_must_come_from_the_update_cache_and_have_the_right_name(windows, tmp_path):
    cache, elsewhere = tmp_path / "cache", tmp_path / "elsewhere"
    cache.mkdir(), elsewhere.mkdir()
    for bad in (elsewhere / "PodStudio-2026.12.05-x64-setup.exe", cache / "evil.exe", cache / "PodStudio-1-x64-setup.exe.bat"):
        bad.write_bytes(b"MZ")
        with pytest.raises(updates.UpdateError):
            updates.install_command(bad, cache=cache)


def test_the_windows_update_check_picks_the_installer_and_its_checksum(monkeypatch, tmp_path):
    monkeypatch.setattr(runtime, "IS_WINDOWS", True)
    exe = b"MZ" + bytes(range(256)) * 50
    name = "PodStudio-2026.12.05-x64-setup.exe"
    base = "http://127.0.0.1:9"
    release = {"tag_name": "v2026.12.05", "body": "notes", "html_url": "https://github.com/o/r/releases/tag/x", "assets": [
        {"name": "podstudio_2026.12.05_amd64.deb", "size": 5, "browser_download_url": f"{base}/dl/d"},
        {"name": name, "size": len(exe), "browser_download_url": f"{base}/dl/{name}"},
        {"name": name + ".sha256", "size": 90, "browser_download_url": f"{base}/dl/{name}.sha256"}]}

    class Resp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self, n=-1): return json.dumps(release).encode()

    class Opener:
        def open(self, req, timeout=0): return Resp()

    monkeypatch.setattr(updates, "_opener", lambda b: (Opener(), b))
    info = updates.check(current="2026.11.20", base=base)
    assert info.deb_name == name and info.can_install and info.sha_url.endswith(".sha256")
    assert hashlib.sha256(exe).hexdigest()                                          # (checksum parsing itself is covered in test_updates)


def test_a_release_with_only_a_deb_is_not_installable_on_windows(monkeypatch):
    monkeypatch.setattr(runtime, "IS_WINDOWS", True)
    release = {"tag_name": "v2026.12.05", "body": "", "html_url": "https://github.com/o/r/releases/tag/x",
               "assets": [{"name": "podstudio_2026.12.05_amd64.deb", "size": 5, "browser_download_url": "http://127.0.0.1:9/d"}]}

    class Resp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self, n=-1): return json.dumps(release).encode()

    monkeypatch.setattr(updates, "_opener", lambda b: (type("O", (), {"open": lambda s, r, timeout=0: Resp()})(), b))
    info = updates.check(current="2026.11.20", base="http://127.0.0.1:9")
    assert not info.can_install and "no installable package" in " ".join(info.problems)


# ------------------------------------------------------------------ credentials (Credential Manager, faked)
def _load_credentials_as_windows(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    spec = importlib.util.spec_from_file_location("credentials_win", ROOT / "podstudio" / "credentials.py")
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except (ImportError, ValueError) as e:                      # ctypes.wintypes is unavailable on some platforms
        pytest.skip(f"cannot load the Windows branch here: {e}")
    return mod


def test_the_token_round_trips_through_a_fake_credential_manager(monkeypatch):
    mod = _load_credentials_as_windows(monkeypatch)
    vault = {}

    class FakeAdvapi:
        def CredWriteW(self, cred_ref, flags):
            c = cred_ref._obj
            vault[c.TargetName] = (c.Type, ctypes.string_at(c.CredentialBlob, c.CredentialBlobSize), c.Persist)
            return 1

        def CredReadW(self, target, kind, flags, out_ref):
            if target not in vault:
                return 0
            _, blob, _ = vault[target]
            buf = (ctypes.c_ubyte * len(blob)).from_buffer_copy(blob)
            c = mod._CREDENTIAL()
            c.CredentialBlobSize, c.CredentialBlob = len(blob), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte))
            keep.append((c, buf))
            out_ref._obj.contents = c
            return 1

        def CredFree(self, p):
            pass

        def CredDeleteW(self, target, kind, flags):
            return 1 if vault.pop(target, None) else 0

    keep = []
    monkeypatch.setattr(mod, "_advapi", lambda: FakeAdvapi())
    assert mod.available() and mod.load() is None
    token = "abc123-ünï-токен"
    assert mod.store(token) is True
    kind, blob, persist = vault[mod._TARGET]
    assert kind == 1 and persist == 2 and blob == token.encode("utf-16-le")        # a generic credential, kept for this machine
    mod.clear()
    assert mod._TARGET not in vault


def test_credentials_fail_soft_when_advapi_is_missing(monkeypatch):
    mod = _load_credentials_as_windows(monkeypatch)
    monkeypatch.setattr(mod, "_advapi", lambda: (_ for _ in ()).throw(OSError("no advapi32")))
    assert mod.load() is None and mod.store("x") is False
    mod.clear()                                                  # must not raise


# ------------------------------------------------------------------ the bundler's pure parts
def _bundle_module():
    spec = importlib.util.spec_from_file_location("bundle_win", ROOT / "packaging" / "windows" / "bundle.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_ntldd_output_is_parsed_into_resolved_dlls():
    b = _bundle_module()
    out = ("\tlibgtk-4-1.dll => C:\\msys64\\ucrt64\\bin\\libgtk-4-1.dll (0x00007ff8a0000000)\n"
           "\tapi-ms-win-crt-runtime-l1-1-0.dll => C:\\Windows\\SYSTEM32\\api-ms-win-crt-runtime-l1-1-0.dll (0x00007ff800000000)\n"
           "\tlibmissing-1.dll => not found\n"
           "\tgarbage line\n")
    assert b.parse_ntldd(out) == [("libgtk-4-1.dll", "C:\\msys64\\ucrt64\\bin\\libgtk-4-1.dll"),
                                  ("api-ms-win-crt-runtime-l1-1-0.dll", "C:\\Windows\\SYSTEM32\\api-ms-win-crt-runtime-l1-1-0.dll")]


def test_only_dlls_under_the_msys2_prefix_are_bundled():
    b = _bundle_module()
    assert b.is_under("/ucrt64/bin/libgtk-4-1.dll", "/ucrt64")
    assert not b.is_under("/ucrt64-other/bin/x.dll", "/ucrt64")
    assert not b.is_under("/windows/system32/kernel32.dll", "/ucrt64")


def test_every_gstreamer_element_the_app_needs_has_a_plugin_in_the_bundle():
    """selftest.py and audio.py name the elements; bundle.py names the plugins that provide them."""
    b = _bundle_module()
    provided = set(b.GST_REQUIRED) | set(b.GST_OPTIONAL)
    element_to_plugin = {"wasapi2src": "wasapi2", "level": "level", "volume": "volume", "tee": "coreelements",
                         "queue": "coreelements", "filesink": "coreelements", "filesrc": "coreelements",
                         "fakesink": "coreelements", "audioconvert": "audioconvert", "audioresample": "audioresample",
                         "wavenc": "wavenc", "decodebin": "playback", "playbin": "playback", "lamemp3enc": "lame",
                         "id3v2mux": "taglib", "autoaudiosink": "autodetect"}
    assert {p for p in element_to_plugin.values()} <= set(b.GST_REQUIRED)
    assert set(element_to_plugin.values()) <= provided


def test_the_launcher_and_scripts_agree_on_names():
    win = ROOT / "packaging" / "windows"
    c = (win / "launcher.c").read_text()
    assert "PODSTUDIO_HOME" in c and "podstudio" in c
    sh = (win / "build.sh").read_text()
    assert "PodStudio-console.exe" in sh and "-mwindows" in sh and "bundle.py" in sh
    iss = (win / "podstudio.iss").read_text()
    assert "PodStudio-{#Version}-x64-setup" in iss and "bin\\PodStudio.exe" in iss
    assert updates.EXE_NAME.match("PodStudio-2026.11.20-7-x64-setup.exe")           # the installer's output name matches the updater
    assert (win / "podstudio.ico").read_bytes()[:4] == b"\x00\x00\x01\x00"          # a real .ico


def test_gstreamer_really_reads_back_the_windows_path_we_put_in_a_pipeline(monkeypatch):
    """Raw backslashes are eaten by gst-launch's parser ('C:\\Users\\Ann' becomes 'C:UsersAnn'); _loc must prevent that."""
    audio = pytest.importorskip("podstudio.audio", exc_type=ImportError)
    from gi.repository import Gst
    monkeypatch.setattr(runtime, "IS_WINDOWS", True)
    for raw in (r"C:\Users\Ann Lee\Music\PodStudio\Ep 1\mic.wav", r'C:\Users\o"brien\mic.wav'):
        pipe = Gst.parse_launch(f'filesrc location="{audio._loc(raw)}" ! fakesink')
        it, back = pipe.iterate_elements(), None
        while True:
            res, el = it.next()
            if res != Gst.IteratorResult.OK:
                break
            if el.find_property("location"):
                back = el.get_property("location")
        assert back == raw.replace("\\", "/")
