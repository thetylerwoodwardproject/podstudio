"""Finding out that a newer PodStudio exists, and installing it safely.

How an update is made trustworthy, since installing a package runs code as root:
  * the release is read over HTTPS from GitHub's API for this project only;
  * downloads are only accepted from GitHub's own hosts, and redirects to anywhere else are refused;
  * a release without a published SHA-256 checksum is never auto-installed (the release page is offered instead);
  * the download is checked against that checksum before anything runs, and deleted if it doesn't match;
  * installation goes through the system's own authorization prompt (pkexec) on Linux, and the package name is validated.
    On Windows the verified installer is started for the current user and PodStudio closes while it runs.
Nothing identifying is sent: the check is an anonymous GET with a generic User-Agent.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from . import __version__, runtime

REPO = "thetylerwoodwardproject/podstudio"
API = "https://api.github.com"
USER_AGENT = f"PodStudio/{__version__} ({'Windows' if runtime.IS_WINDOWS else 'Linux'} desktop app)"
CHECK_INTERVAL = 24 * 3600
MAX_DEB_BYTES = 250 * 1000 * 1000
MAX_EXE_BYTES = 700 * 1000 * 1000                  # the Windows installer carries its own copy of GTK, GStreamer and Python
CACHE_DIR = runtime.user_cache_dir() / "updates"
ALLOWED_HOSTS = ("github.com", "api.github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")
DEB_NAME = re.compile(r"^podstudio_[0-9][0-9.]*(-[0-9]+)?_amd64\.deb$")
EXE_NAME = re.compile(r"^PodStudio-[0-9][0-9.]*(-[0-9]+)?-x64-setup\.exe$")


def package_name_pattern():
    """Which release asset is ours: the installer on Windows, the .deb on Debian-family Linux."""
    return EXE_NAME if runtime.IS_WINDOWS else DEB_NAME


def max_package_bytes() -> int:
    return MAX_EXE_BYTES if runtime.IS_WINDOWS else MAX_DEB_BYTES


class UpdateError(Exception):
    pass


# ===================================================================== versions
def version_key(v: str):
    """'v2026.11.20' -> (2026, 11, 20, 0); '2026.11.20-3' -> (2026, 11, 20, 3). None if it isn't a version."""
    m = re.fullmatch(r"v?(\d+(?:\.\d+){1,3})(?:-(\d+))?", (v or "").strip())
    if not m:
        return None
    nums = tuple(int(x) for x in m.group(1).split("."))
    nums += (0,) * (3 - len(nums))                    # 2026.11 == 2026.11.0
    return nums + (int(m.group(2) or 0),)


def _asset_version(name: str) -> str:
    """'podstudio_2026.11.20-3_amd64.deb' or 'PodStudio-2026.11.20-3-x64-setup.exe' -> '2026.11.20-3'."""
    m = re.match(r"^(?:podstudio_|PodStudio-)([0-9][0-9.]*(?:-[0-9]+)?)(?:_amd64\.deb|-x64-setup\.exe)$", name)
    return m.group(1) if m else ""


def is_newer(candidate: str, current: str) -> bool:
    a, b = version_key(candidate), version_key(current)
    return a is not None and b is not None and a > b


def installed_version() -> str | None:
    """The package version dpkg has (e.g. 2026.11.20-3), or None when PodStudio wasn't installed from the .deb.
    The Windows build records its own in a VERSION file (written when it is built), so rebuilds of the same date
    aren't offered as updates to themselves."""
    home = runtime.windows_home()
    if home is not None:
        try:
            return (home / "VERSION").read_text(encoding="utf-8").strip() or None
        except OSError:
            return None
    try:
        out = subprocess.run(["dpkg-query", "-W", "-f=${Version}", "podstudio"], capture_output=True, text=True, timeout=5)
        return out.stdout.strip() or None if out.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def current_version() -> str:
    return installed_version() or __version__


def installed_from_deb() -> bool:
    return not runtime.IS_WINDOWS and installed_version() is not None and "/usr/lib/podstudio" in str(Path(__file__).resolve())


def installed_from_installer() -> bool:
    """Windows: this copy was put there by the setup program (so it has an uninstaller), not unzipped by hand."""
    home = runtime.windows_home()
    return home is not None and (home / "unins000.exe").exists()


def can_self_install() -> bool:
    """Whether PodStudio can install an update itself: the .deb on Linux, the setup program on Windows."""
    return installed_from_installer() if runtime.IS_WINDOWS else installed_from_deb()


def how_installed() -> str:
    return "the Windows installer" if runtime.IS_WINDOWS else "the .deb package"


def should_check(last_check: float, now: float | None = None, interval: float = CHECK_INTERVAL) -> bool:
    if not last_check:                                   # never checked
        return True
    return (now if now is not None else time.time()) - float(last_check) >= interval


# ===================================================================== release lookup
@dataclass
class UpdateInfo:
    version: str                       # as tagged, without the leading v
    notes: str
    page: str                          # the release page, always safe to open
    deb_url: str = ""
    deb_name: str = ""
    deb_size: int = 0
    sha_url: str = ""
    problems: list[str] = field(default_factory=list)

    @property
    def can_install(self) -> bool:
        return bool(self.deb_url and self.sha_url and not self.problems)


def _host_ok(url: str, extra_local: str | None = None) -> bool:
    p = urllib.parse.urlparse(url)
    if extra_local and p.scheme == "http" and p.hostname == "127.0.0.1" and url.startswith(extra_local):
        return True                                           # tests only: a local mock server
    return p.scheme == "https" and any(p.hostname == h or (p.hostname or "").endswith("." + h) for h in ALLOWED_HOSTS)


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    """Follow redirects (GitHub serves downloads from a CDN) but only to GitHub's own hosts over HTTPS."""

    def __init__(self, local_base=None):
        self.local_base = local_base

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not _host_ok(newurl, self.local_base):
            raise UpdateError(f"Refusing to follow a redirect to {urllib.parse.urlparse(newurl).hostname}.")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _opener(base: str):
    local = base if base.startswith("http://127.0.0.1") else None
    return urllib.request.build_opener(_SafeRedirect(local)), local


def check(current: str | None = None, base: str = API, repo: str = REPO, timeout: float = 15.0) -> UpdateInfo | None:
    """Ask GitHub for the latest release. Returns UpdateInfo when it is newer than `current`, else None.

    Having no releases yet (a 404) is normal and means "no update"."""
    current = current or current_version()
    opener, local = _opener(base)
    req = urllib.request.Request(f"{base}/repos/{repo}/releases/latest",
                                 headers={"Accept": "application/vnd.github+json", "User-Agent": USER_AGENT})
    try:
        with opener.open(req, timeout=timeout) as r:
            rel = json.loads(r.read(2_000_000))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise UpdateError(f"GitHub answered {e.code}.") from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise UpdateError(f"Couldn't reach GitHub: {getattr(e, 'reason', e)}") from None
    except ValueError:
        raise UpdateError("GitHub sent something unreadable.") from None
    if rel.get("draft") or rel.get("prerelease"):
        return None
    tag = (rel.get("tag_name") or "").strip()
    if not is_newer(tag, current):
        return None
    info = UpdateInfo(version=tag.lstrip("v"), notes=(rel.get("body") or "").strip(), page=rel.get("html_url") or
                      f"https://github.com/{repo}/releases")
    assets = {a.get("name", ""): a for a in rel.get("assets", []) if isinstance(a, dict)}
    pattern = package_name_pattern()
    debs = [n for n in assets if pattern.match(n)]
    if not debs:
        info.problems.append("This release has no installable package for your system.")
        return info
    name = sorted(debs, key=lambda n: version_key(_asset_version(n)) or ())[-1]
    info.deb_name, info.deb_url, info.deb_size = name, assets[name].get("browser_download_url", ""), int(assets[name].get("size") or 0)
    sha = assets.get(name + ".sha256")
    if sha:
        info.sha_url = sha.get("browser_download_url", "")
    else:
        info.problems.append("This release doesn't publish a checksum, so PodStudio won't install it automatically.")
    for u in (info.deb_url, info.sha_url):
        if u and not _host_ok(u, local):
            info.problems.append("This release points at a download host that PodStudio doesn't trust.")
            break
    if info.deb_size and info.deb_size > max_package_bytes():
        info.problems.append("The package is much larger than expected.")
    return info


# ===================================================================== download, verify, install
def _fetch(url: str, base: str, timeout: float = 60.0, limit: int | None = None):
    opener, local = _opener(base)
    if not _host_ok(url, local):
        raise UpdateError("Refusing to download from an untrusted host.")
    return opener.open(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=timeout)


def parse_checksum(text: str, filename: str) -> str:
    """First 64-hex token. If the line names a file, it must be this one."""
    for line in text.splitlines():
        m = re.match(r"^\s*([0-9a-fA-F]{64})(?:\s+\*?(.+?))?\s*$", line)
        if m and (not m.group(2) or Path(m.group(2)).name == filename):
            return m.group(1).lower()
    raise UpdateError("The published checksum couldn't be read.")


def download(info: UpdateInfo, progress=None, base: str = API, cache: Path = CACHE_DIR) -> Path:
    """Download the package and verify it against the published checksum. Returns the verified file's path."""
    if not info.can_install:
        raise UpdateError(" ".join(info.problems) or "This update can't be installed automatically.")
    cache.mkdir(parents=True, exist_ok=True)
    with _fetch(info.sha_url, base) as r:
        expected = parse_checksum(r.read(4096).decode("utf-8", "replace"), info.deb_name)
    final, part = cache / info.deb_name, cache / (info.deb_name + ".part")
    h, got = hashlib.sha256(), 0
    try:
        with _fetch(info.deb_url, base) as r, open(part, "wb") as f:
            total = int(r.headers.get("Content-Length") or info.deb_size or 0)
            if total > max_package_bytes():
                raise UpdateError("The package is much larger than expected.")
            while chunk := r.read(1 << 18):
                got += len(chunk)
                if got > max_package_bytes():
                    raise UpdateError("The download is much larger than expected.")
                h.update(chunk)
                f.write(chunk)
                if progress:
                    progress(got, total)
        if not hmac.compare_digest(h.hexdigest(), expected):
            raise UpdateError("The download doesn't match its published checksum, so it was discarded.")
        os.replace(part, final)
    except (urllib.error.URLError, OSError) as e:
        raise UpdateError(f"The download failed: {getattr(e, 'reason', e)}") from None
    finally:
        part.unlink(missing_ok=True)
    return final


def install_command(deb: Path, cache: Path = CACHE_DIR) -> list[str]:
    """The exact command that is run with elevated rights. Only a verified package in our cache may be passed to it."""
    deb = Path(deb).resolve()
    if deb.parent != Path(cache).resolve() or not package_name_pattern().match(deb.name):
        raise UpdateError("That isn't a PodStudio package from the update cache.")
    if runtime.IS_WINDOWS:                              # per-user setup: no administrator prompt, and PodStudio is closed
        return [str(deb), "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS", "/RELAUNCH=1"]
    return ["pkexec", "apt-get", "install", "-y", str(deb)]


def start_windows_installer(setup: Path, cache: Path = CACHE_DIR) -> None:
    """Windows: start the verified setup program on its own and return at once. The caller then closes PodStudio,
    because setup can't replace files that are in use; setup reopens PodStudio when it has finished."""
    cmd = install_command(setup, cache)
    flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    try:
        subprocess.Popen(cmd, creationflags=flags, close_fds=True, stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as e:
        raise UpdateError(f"Couldn't start the installer: {e}. You can run it yourself: {setup}") from None


def install(deb: Path, cache: Path = CACHE_DIR, timeout: float = 900.0) -> str:
    """Install through the system's authorization prompt. Returns a short summary; raises UpdateError with advice."""
    if runtime.IS_WINDOWS:
        start_windows_installer(deb, cache)
        return "Started."
    cmd = install_command(deb, cache)
    if shutil.which("pkexec") is None:
        raise UpdateError("Installing needs administrator rights and pkexec isn't available. Run:  sudo apt install " + str(deb))
    try:
        run = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise UpdateError("The installation took too long and was stopped.") from None
    if run.returncode in (126, 127):
        raise UpdateError("The installation wasn't authorized.")
    if run.returncode != 0:
        tail = (run.stderr or run.stdout).strip().splitlines()[-1:] or ["unknown error"]
        raise UpdateError(f"The installation failed: {tail[0]}  You can also run:  sudo apt install {deb}")
    return "Installed."
