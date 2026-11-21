#!/usr/bin/env python3
"""Assemble the Windows build of PodStudio from an MSYS2 UCRT64 install.

    python packaging/windows/bundle.py <output-dir> [--version 2026.11.20-7]

Run it with MSYS2's own Python (the one in /ucrt64), after `packaging/windows/build.sh` has compiled the launcher.
It copies Python, the app, GTK 4, libadwaita, GStreamer (only the plugins PodStudio uses), the GObject typelibs,
icons, schemas and every DLL they need, into a folder that runs from anywhere with no MSYS2 or Python installed:

    <output>\\bin\\PodStudio.exe          the launcher (and PodStudio-console.exe, which prints to a terminal)
    <output>\\bin\\*.dll, deep-filter.exe  libraries and the noise-reduction tool
    <output>\\lib\\python3.x\\...          the standard library and site-packages (gi, numpy, scipy, podstudio, ...)
    <output>\\lib\\gstreamer-1.0, girepository-1.0, gdk-pixbuf-2.0
    <output>\\share\\...                   schemas, icons

DLLs are found by asking `ntldd` what each executable, extension module and plugin links to, then copying whatever
lives under the MSYS2 prefix. Windows' own DLLs are left alone.
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREFIX = Path(sys.prefix)                                   # e.g. C:\msys64\ucrt64
PYVER = "%d.%d" % sys.version_info[:2]
APP_ID = "io.github.thetylerwoodwardproject.PodStudio"

# GStreamer plugins PodStudio uses, by plugin name (file libgst<name>.dll). `required` ones fail the build if missing.
GST_REQUIRED = ["coreelements", "audioconvert", "audioresample", "volume", "level", "wavenc", "wavparse", "playback",
                "typefindfunctions", "audioparsers", "autodetect", "lame", "id3tag", "wasapi2"]
GST_OPTIONAL = ["wasapi", "app", "audiofx", "flac", "ogg", "vorbis", "opus", "mpg123", "id3demux", "isomp4", "apetag",
                "audiotestsrc", "gio"]

# Everything in site-packages is copied except build and test tooling. (An allowlist kept missing small helper modules
# such as typing_extensions that the real packages import.)
SITE_SKIP = {"pip", "setuptools", "pkg_resources", "wheel", "_distutils_hack", "pytest", "_pytest", "pluggy", "iniconfig",
             "pygments", "__pycache__", "tests", "test", "_pyinstaller", "distutils-precedence.pth", "py.py", "pyproject_hooks"}
SITE_SKIP_PREFIX = ("pip-", "setuptools-", "wheel-", "pytest-", "pluggy-", "iniconfig-", "pygments-", "pyproject_hooks-")

# GObject typelibs to ship (by file-name prefix): GTK 4, libadwaita, GStreamer and what they depend on.
TYPELIBS = ("GLib-", "GObject-", "Gio-", "GModule-", "GioWin32-", "Gtk-4", "Gdk-4", "GdkWin32-", "Gsk-", "Adw-", "Graphene-",
            "Pango-", "PangoCairo-", "PangoWin32-", "cairo-", "freetype2-", "HarfBuzz-", "GdkPixbuf-", "Gst-", "GstBase-",
            "GstAudio-", "GstPbutils-", "GstTag-", "GstApp-", "GstVideo-", "GstNet-", "GstController-", "GstCheck-")

PY_SKIP_DIRS = {"test", "tests", "idlelib", "tkinter", "turtledemo", "lib2to3", "ensurepip", "__pycache__",
                "site-packages", "pydoc_data", "distutils"}


# ----------------------------------------------------------------------------- DLL discovery
_NTLDD = re.compile(r"^\s*(\S+)\s+=>\s+(.+?)\s+\(0x[0-9a-fA-F]+\)\s*$")


def parse_ntldd(output: str) -> list[tuple[str, str]]:
    """`ntldd -R` output -> [(dll name, resolved path)]. Lines that couldn't be resolved are skipped."""
    found = []
    for line in output.splitlines():
        m = _NTLDD.match(line)
        if m and m.group(2).strip().lower() != "not found":
            found.append((m.group(1), m.group(2).strip()))
    return found


def is_under(path: str | Path, prefix: str | Path) -> bool:
    """True if `path` is inside `prefix` (case-insensitive, either slash style: this is Windows)."""
    a = os.path.normcase(os.path.normpath(str(path)))
    b = os.path.normcase(os.path.normpath(str(prefix)))
    return a == b or a.startswith(b.rstrip("\\/") + os.sep)


def ntldd(path: Path) -> list[Path]:
    run = subprocess.run(["ntldd", "-R", str(path)], capture_output=True, text=True)
    return [Path(p) for _, p in parse_ntldd(run.stdout) if is_under(p, PREFIX)]


# ----------------------------------------------------------------------------- copying
def copytree(src: Path, dst: Path, skip_dirs=(), skip_suffix=(".pyc",)) -> None:
    shutil.copytree(src, dst, dirs_exist_ok=True,
                    ignore=lambda d, names: [n for n in names if n in skip_dirs or n.endswith(skip_suffix)])


def need(path: Path, what: str) -> Path:
    if not path.exists():
        sys.exit(f"bundle.py: missing {what}: {path}")
    return path


class Bundle:
    def __init__(self, out: Path):
        self.out = out
        self.bin = out / "bin"
        self.lib = out / "lib"
        self.site = self.lib / f"python{PYVER}" / "site-packages"
        self.dlls: set[Path] = set()
        self.roots: list[Path] = []                       # files whose dependencies still have to be collected

    def add_root(self, path: Path) -> None:
        self.roots.append(path)

    def collect_dlls(self) -> None:
        seen: set[Path] = set()
        queue = list(self.roots)
        while queue:
            f = queue.pop()
            if f in seen:
                continue
            seen.add(f)
            for dep in ntldd(f):
                if dep.suffix.lower() == ".dll" and dep not in self.dlls:
                    self.dlls.add(dep)
                    queue.append(dep)
        for dll in sorted(self.dlls):
            target = self.bin / dll.name
            if not target.exists():
                shutil.copy2(dll, target)

    # ------------------------------------------------------------------ pieces
    def python(self) -> None:
        std = need(PREFIX / "lib" / f"python{PYVER}", "the Python standard library")
        copytree(std, self.lib / f"python{PYVER}", PY_SKIP_DIRS)
        self.site.mkdir(parents=True, exist_ok=True)
        libpy = need(PREFIX / "bin" / f"libpython{PYVER}.dll", "libpython")
        shutil.copy2(libpy, self.bin / libpy.name)
        self.add_root(libpy)
        for ext in (self.lib / f"python{PYVER}").rglob("*"):          # lib-dynload extension modules
            if ext.suffix.lower() in (".pyd", ".dll"):
                self.add_root(ext)

    def site_packages(self, extra_dirs: list[Path]) -> None:
        sources = [PREFIX / "lib" / f"python{PYVER}" / "site-packages", *extra_dirs]
        for src in sources:
            for item in src.iterdir():
                if item.name in SITE_SKIP or item.name.startswith(SITE_SKIP_PREFIX):
                    continue
                dst = self.site / item.name
                if item.is_dir():
                    copytree(item, dst, SITE_SKIP)
                else:
                    shutil.copy2(item, dst)
        for ext in self.site.rglob("*"):
            if ext.suffix.lower() in (".pyd", ".dll"):
                self.add_root(ext)

    def app(self) -> None:
        copytree(ROOT / "podstudio", self.site / "podstudio", {"__pycache__"})

    def gstreamer(self) -> None:
        plugdir = need(PREFIX / "lib" / "gstreamer-1.0", "GStreamer plugins")
        dst = self.lib / "gstreamer-1.0"
        dst.mkdir(parents=True, exist_ok=True)
        for name in GST_REQUIRED + GST_OPTIONAL:
            f = plugdir / f"libgst{name}.dll"
            if f.exists():
                shutil.copy2(f, dst / f.name)
                self.add_root(f)
            elif name in GST_REQUIRED:
                sys.exit(f"bundle.py: required GStreamer plugin missing: {f.name}")
            else:
                print(f"note: optional GStreamer plugin not installed: {f.name}")
        scanner = PREFIX / "libexec" / "gstreamer-1.0" / "gst-plugin-scanner.exe"
        if scanner.exists():
            (self.out / "libexec" / "gstreamer-1.0").mkdir(parents=True, exist_ok=True)
            shutil.copy2(scanner, self.out / "libexec" / "gstreamer-1.0" / scanner.name)
            self.add_root(scanner)

    def gobject(self) -> None:
        src = need(PREFIX / "lib" / "girepository-1.0", "GObject typelibs")
        dst = self.lib / "girepository-1.0"
        dst.mkdir(parents=True, exist_ok=True)
        for tl in sorted(src.glob("*.typelib")):
            if tl.name.startswith(TYPELIBS):
                shutil.copy2(tl, dst / tl.name)
        # A typelib names the DLL it wraps (libgtk-4-1.dll, ...) and GObject Introspection loads it at run time, so no
        # executable links to it and ntldd can't see it. Read the names out of the typelibs and treat them as roots.
        for tl in dst.glob("*.typelib"):
            for name in re.findall(rb"lib[A-Za-z0-9_.+-]*\.dll", tl.read_bytes()):
                dll = PREFIX / "bin" / name.decode()
                if dll.exists():
                    self.add_root(dll)
                    self.dlls.add(dll)
        loaders = PREFIX / "lib" / "gdk-pixbuf-2.0"
        if loaders.exists():
            copytree(loaders, self.lib / "gdk-pixbuf-2.0", skip_suffix=(".pyc", ".cache"))   # winenv makes its own cache
            for f in (self.lib / "gdk-pixbuf-2.0").rglob("*.dll"):
                self.add_root(f)
        for tool in ("gdk-pixbuf-query-loaders.exe", "glib-compile-schemas.exe"):
            f = PREFIX / "bin" / tool
            if f.exists():
                shutil.copy2(f, self.bin / tool)
                self.add_root(f)

    def native_libraries(self) -> None:
        """DLLs that Python loads by name (ctypes, cffi) rather than links, so ntldd can't see them."""
        for name in ("libsndfile-1.dll", "libhidapi-0.dll"):
            f = PREFIX / "bin" / name
            if not f.exists():
                sys.exit(f"bundle.py: {name} is not installed in {PREFIX / 'bin'}")
            shutil.copy2(f, self.bin / name)
            self.add_root(f)

    def data(self) -> None:
        share = self.out / "share"
        for sub in ("glib-2.0/schemas",):
            src = PREFIX / "share" / sub
            if src.exists():
                copytree(src, share / sub, skip_suffix=(".pyc", ".compiled"))
        for theme in ("Adwaita", "hicolor"):                  # GTK's own icons; big raster sizes are left out
            src = PREFIX / "share" / "icons" / theme
            if src.exists():
                copytree(src, share / "icons" / theme, skip_dirs={"256x256", "512x512", "cursors"})
        app_icons = ROOT / "data" / "icons" / "hicolor"       # PodStudio's own icon, so the About box finds it
        copytree(app_icons, share / "icons" / "hicolor")
        scalable = share / "icons" / "hicolor" / "scalable" / "apps"
        scalable.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / "data" / f"{APP_ID}.svg", scalable / f"{APP_ID}.svg")
        if (self.bin / "glib-compile-schemas.exe").exists():
            subprocess.run([str(self.bin / "glib-compile-schemas.exe"), str(share / "glib-2.0" / "schemas")], check=True)
        for candidate in (PREFIX / "etc" / "ssl" / "certs" / "ca-bundle.crt", PREFIX / "ssl" / "certs" / "ca-bundle.crt"):
            if candidate.exists():                            # HTTPS to GitHub and Buzzsprout needs a CA list
                (self.out / "ssl").mkdir(exist_ok=True)
                shutil.copy2(candidate, self.out / "ssl" / "cacert.pem")
                break
        else:
            print("note: no CA bundle found; HTTPS will rely on the Windows certificate store")

    def launchers(self, build_dir: Path) -> None:
        for name in ("PodStudio.exe", "PodStudio-console.exe"):
            f = need(build_dir / name, "a compiled launcher (run packaging/windows/build.sh)")
            shutil.copy2(f, self.bin / name)
            self.add_root(f)

    def extras(self, deepfilter: Path, version: str) -> None:
        shutil.copy2(need(deepfilter, "deep-filter.exe (packaging/windows/fetch-deepfilter.sh)"), self.bin / "deep-filter.exe")
        docs = self.out / "licenses"
        docs.mkdir(exist_ok=True)
        for src in (ROOT / "LICENSE", ROOT / "NOTICE", ROOT / "packaging" / "licenses" / "DeepFilterNet-LICENSE-MIT",
                    ROOT / "packaging" / "licenses" / "DeepFilterNet-LICENSE-APACHE"):
            if src.exists():
                shutil.copy2(src, docs / src.name)
        (self.out / "VERSION").write_text(version + "\n", encoding="utf-8")        # what the in-app updater compares


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out", type=Path)
    ap.add_argument("--version", required=True, help="e.g. 2026.11.20-7 (date plus packaging/revision)")
    ap.add_argument("--build-dir", type=Path, default=ROOT / "build" / "windows", help="where the launchers were compiled")
    ap.add_argument("--vendor", type=Path, default=ROOT / "packaging" / "vendor")
    ap.add_argument("--pydeps", type=Path, default=ROOT / "build" / "windows" / "pydeps",
                    help="folder with pip-installed pure-Python packages (comtypes, pycaw)")
    a = ap.parse_args()

    if not sys.platform == "win32":
        sys.exit("bundle.py: run this with MSYS2's Python on Windows.")
    if a.out.exists():
        shutil.rmtree(a.out)
    b = Bundle(a.out.resolve())
    b.bin.mkdir(parents=True)

    b.python()
    b.site_packages([a.pydeps] if a.pydeps.exists() else [])
    b.app()
    b.gstreamer()
    b.gobject()
    b.native_libraries()
    b.launchers(a.build_dir)
    b.collect_dlls()
    b.data()
    b.extras(a.vendor / "deep-filter.exe", a.version)
    size = sum(f.stat().st_size for f in a.out.rglob("*") if f.is_file())
    print(f"Bundled {len(b.dlls)} DLLs; {size / 1e6:.0f} MB in {a.out}")


if __name__ == "__main__":
    main()
