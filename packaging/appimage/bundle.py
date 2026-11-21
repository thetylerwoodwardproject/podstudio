#!/usr/bin/env python3
"""Assemble a PodStudio AppDir from this machine's own (Debian/Ubuntu) packages.

    packaging/appimage/bundle.py <AppDir>

It copies Python, the app, its libraries (GTK 4, libadwaita, GStreamer and everything they link to), GObject
typelibs, GStreamer plugins, icons and schemas, and writes an AppRun that points everything at the bundle.
glibc and graphics-driver libraries are deliberately NOT copied: they must come from the machine it runs on.
Because the libraries come from the build machine, the result runs on that Ubuntu release and newer.
"""
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APPDIR = Path(sys.argv[1]).resolve()
U = APPDIR / "usr"
LIB = U / "lib" / "x86_64-linux-gnu"
PYVER = "%d.%d" % sys.version_info[:2]
ID = "io.github.thetylerwoodwardproject.PodStudio"

# Libraries that must come from the host: the C library, and anything tied to the graphics driver or sound server.
EXCLUDE = re.compile(r"^(ld-linux.*|libc\.so.*|libm\.so.*|libdl\.so.*|libpthread\.so.*|librt\.so.*|libutil\.so.*|libresolv\.so.*"
                     r"|libnss_.*|libnsl.*|libcrypt\.so.*|libanl.*|libBrokenLocale.*|libthread_db.*|libGL.*|libEGL.*|libGLX.*"
                     r"|libOpenGL.*|libGLdispatch.*|libGLESv.*|libdrm.*|libgbm.*|libvulkan.*|libnvidia.*|libcuda.*|libasound\.so.*"
                     r"|libwayland-egl.*|libX11-xcb.*|libxcb-dri.*|libxshmfence.*|libLLVM.*|libudev\.so.*|libselinux.*|libsystemd.*)$")
MIN_PY_SKIP = {"test", "tests", "idlelib", "tkinter", "turtledemo", "lib2to3", "ensurepip", "__pycache__", "config-%s-x86_64-linux-gnu" % PYVER}


def run(*cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw).stdout


def dpkg_files(*pkgs):
    out = subprocess.run(["dpkg", "-L", *pkgs], capture_output=True, text=True).stdout
    return [Path(p) for p in out.splitlines() if p.startswith("/") and Path(p).is_file()]


def copytree(src, dst, skip=()):
    shutil.copytree(src, dst, symlinks=True, dirs_exist_ok=True,
                    ignore=lambda d, names: [n for n in names if n in skip or n.endswith(".pyc")])


def is_elf(p: Path) -> bool:
    try:
        with open(p, "rb") as f:
            return f.read(4) == b"\x7fELF"
    except OSError:
        return False


def needed(path: Path):
    out = subprocess.run(["ldd", str(path)], capture_output=True, text=True).stdout
    for line in out.splitlines():
        m = re.match(r"\s*(\S+) => (/\S+)", line)
        if m:
            yield m.group(1), Path(m.group(2))


def main():
    if APPDIR.exists():
        shutil.rmtree(APPDIR)
    LIB.mkdir(parents=True)

    # ---- Python: interpreter, standard library, and only the third-party packages the app needs
    py = Path(os.path.realpath(sys.executable if sys.executable.startswith("/usr/bin") else "/usr/bin/python3"))
    (U / "bin").mkdir(parents=True)
    shutil.copy2(py, U / "bin" / f"python{PYVER}")
    (U / "bin" / "python3").symlink_to(f"python{PYVER}")
    copytree(Path("/usr/lib") / f"python{PYVER}", U / "lib" / f"python{PYVER}", MIN_PY_SKIP)
    dist = Path("/usr/lib/python3/dist-packages")
    (U / "lib" / "python3" / "dist-packages").mkdir(parents=True)
    for name in ("gi", "numpy", "scipy", "soundfile.py", "_soundfile.py", "_soundfile_data", "cffi", "pycparser", "decorator.py"):
        if (dist / name).exists():
            (copytree if (dist / name).is_dir() else shutil.copy2)(dist / name, U / "lib" / "python3" / "dist-packages" / name)
    for f in dist.glob("_cffi_backend*.so"):
        shutil.copy2(f, U / "lib" / "python3" / "dist-packages" / f.name)

    # ---- the app and its bundled DeepFilterNet
    copytree(ROOT / "podstudio", U / "lib" / "podstudio" / "podstudio", {"__pycache__"})
    (U / "lib" / "podstudio" / "bin").mkdir(parents=True)
    shutil.copy2(ROOT / "packaging" / "vendor" / "deep-filter", U / "lib" / "podstudio" / "bin" / "deep-filter")

    # ---- GObject typelibs, GStreamer plugins, GDK-Pixbuf loaders
    typelibs = Path("/usr/lib/x86_64-linux-gnu/girepository-1.0")
    copytree(typelibs, U / "lib" / "girepository-1.0")
    gst = LIB / "gstreamer-1.0"
    gst.mkdir()
    for f in dpkg_files("libgstreamer1.0-0", "gstreamer1.0-plugins-base", "gstreamer1.0-plugins-good"):
        if f.suffix == ".so" and "gstreamer-1.0" in f.parts:
            shutil.copy2(f, gst / f.name)
    scanner_dst = LIB / "gstreamer1.0" / "gstreamer-1.0"
    scanner_dst.mkdir(parents=True)
    shutil.copy2("/usr/lib/x86_64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner", scanner_dst / "gst-plugin-scanner")
    pix = Path("/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0")
    copytree(pix, LIB / "gdk-pixbuf-2.0", {"loaders.cache"})
    (U / "lib" / "gio" / "modules").mkdir(parents=True)                   # empty on purpose: never load the host's GIO modules

    # ---- shared libraries: everything the above link against, except what must come from the host
    seeds = ["libgtk-4.so.1", "libadwaita-1.so.0", "libgstreamer-1.0.so.0", "libgstbase-1.0.so.0", "libgstaudio-1.0.so.0",
             "libgstpbutils-1.0.so.0", "libgsttag-1.0.so.0", "libgstapp-1.0.so.0", "libsecret-1.so.0", "libgdk_pixbuf-2.0.so.0",
             "libgraphene-1.0.so.0", "libpangocairo-1.0.so.0", "libcairo-gobject.so.2", "libgirepository-1.0.so.1",
             "libsndfile.so.1", "libffi.so.8", "libgio-2.0.so.0", "libgmodule-2.0.so.0", "libgthread-2.0.so.0"]
    queue = [p for p in U.rglob("*") if p.is_file() and not p.is_symlink() and is_elf(p)]
    for s in seeds:
        out = subprocess.run(["ldconfig", "-p"], capture_output=True, text=True).stdout
        m = re.search(r"\s" + re.escape(s) + r" \(.*\) => (/\S+)", out)
        if m:
            queue.append(Path(m.group(1)))
        else:
            print(f"warning: seed library {s} not found on this machine", file=sys.stderr)
    scanner = scanner_dst / "gst-plugin-scanner"
    queue.append(scanner)
    seen = set()
    copied = 0
    while queue:
        f = queue.pop()
        key = str(f.resolve())
        if key in seen:
            continue
        seen.add(key)
        for soname, real in needed(f):
            if EXCLUDE.match(soname) or soname in seen:
                continue
            dst = LIB / soname
            if not dst.exists():
                shutil.copy2(real.resolve(), dst)
                copied += 1
                queue.append(real)
    # the seeds themselves also have to be present under their own names
    for s in seeds:
        out = subprocess.run(["ldconfig", "-p"], capture_output=True, text=True).stdout
        m = re.search(r"\s" + re.escape(s) + r" \(.*\) => (/\S+)", out)
        if m and not (LIB / s).exists() and not EXCLUDE.match(s):
            shutil.copy2(Path(m.group(1)).resolve(), LIB / s)
            copied += 1
    print(f"bundled {copied} shared libraries", file=sys.stderr)

    # ---- data: schemas, icons, and our own desktop integration
    schemas = U / "share" / "glib-2.0" / "schemas"
    schemas.mkdir(parents=True)
    for x in Path("/usr/share/glib-2.0/schemas").glob("*.xml"):
        shutil.copy2(x, schemas)
    for x in Path("/usr/share/glib-2.0/schemas").glob("*.override"):
        shutil.copy2(x, schemas)
    run("glib-compile-schemas", str(schemas))
    copytree(Path("/usr/share/icons/Adwaita"), U / "share" / "icons" / "Adwaita")
    (U / "share" / "icons" / "hicolor").mkdir(parents=True, exist_ok=True)
    shutil.copy2("/usr/share/icons/hicolor/index.theme", U / "share" / "icons" / "hicolor" / "index.theme")
    for png in (ROOT / "data" / "icons" / "hicolor").glob(f"*/apps/{ID}.png"):
        d = U / "share" / "icons" / "hicolor" / png.parent.parent.name / "apps"
        d.mkdir(parents=True, exist_ok=True)
        shutil.copy2(png, d / png.name)
    (U / "share" / "applications").mkdir(parents=True, exist_ok=True)
    desktop = (ROOT / "data" / f"{ID}.desktop").read_text().replace("@EXEC@", "podstudio")
    (U / "share" / "applications" / f"{ID}.desktop").write_text(desktop)
    (APPDIR / f"{ID}.desktop").write_text(desktop)
    shutil.copy2(ROOT / "data" / "icons" / "hicolor" / "256x256" / "apps" / f"{ID}.png", APPDIR / f"{ID}.png")
    (APPDIR / ".DirIcon").symlink_to(f"{ID}.png")
    (U / "share" / "metainfo").mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / "data" / f"{ID}.metainfo.xml", U / "share" / "metainfo" / f"{ID}.metainfo.xml")

    # ---- AppRun
    apprun = APPDIR / "AppRun"
    apprun.write_text(f'''#!/bin/sh
# PodStudio AppImage launcher: point every library, plugin and data lookup at the bundle.
HERE="$(dirname "$(readlink -f "$0")")"
export APPDIR="${{APPDIR:-$HERE}}"
U="$HERE/usr"
export PATH="$U/bin:$PATH"
export LD_LIBRARY_PATH="$U/lib/x86_64-linux-gnu${{LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}}"
export PYTHONHOME="$U"
export PYTHONPATH="$U/lib/podstudio"
export PYTHONDONTWRITEBYTECODE=1
export GI_TYPELIB_PATH="$U/lib/girepository-1.0"
export GST_PLUGIN_SYSTEM_PATH_1_0="$U/lib/x86_64-linux-gnu/gstreamer-1.0"
export GST_PLUGIN_PATH_1_0="$GST_PLUGIN_SYSTEM_PATH_1_0"
export GST_PLUGIN_SCANNER="$U/lib/x86_64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"
export GSETTINGS_SCHEMA_DIR="$U/share/glib-2.0/schemas"
export GIO_MODULE_DIR="$U/lib/gio/modules"
export XDG_DATA_DIRS="$U/share:${{XDG_DATA_DIRS:-/usr/local/share:/usr/share}}"
cache="${{XDG_CACHE_HOME:-$HOME/.cache}}/podstudio"
mkdir -p "$cache"
export GST_REGISTRY_1_0="$cache/appimage-gst-registry.bin"
export GDK_PIXBUF_MODULEDIR="$U/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders"
export GDK_PIXBUF_MODULE_FILE="$cache/appimage-pixbuf-loaders.cache"
"$U/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/gdk-pixbuf-query-loaders" > "$GDK_PIXBUF_MODULE_FILE" 2>/dev/null
exec "$U/bin/python3" -m podstudio "$@"
''')
    apprun.chmod(0o755)
    size = sum(f.stat().st_size for f in APPDIR.rglob("*") if f.is_file()) / 1e6
    print(f"AppDir ready: {size:.0f} MB at {APPDIR}", file=sys.stderr)


main()
