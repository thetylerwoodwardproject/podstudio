#!/usr/bin/env python3
"""Write python-deps.json: the Flatpak module that installs PodStudio's Python dependencies from pinned wheels.

Flatpak builds have no network, so every wheel is listed with its URL and SHA-256. The whole dependency tree is
resolved from PyPI's own metadata (so a new dependency of a new release can't be missed). Run this when the
runtime's Python version changes or a dependency should be bumped:

    packaging/flatpak/gen-wheels.py --python 3.13 > packaging/flatpak/python-deps.json
"""
import argparse
import json
import sys
import urllib.request
from collections import deque

try:
    from packaging.requirements import Requirement
    from packaging.specifiers import SpecifierSet
    from packaging.version import Version
except ImportError:                                           # pip ships a vendored copy
    from pip._vendor.packaging.requirements import Requirement
    from pip._vendor.packaging.specifiers import SpecifierSet
    from pip._vendor.packaging.version import Version

ROOTS = ["scipy", "soundfile"]                               # scipy first: it decides which numpy is acceptable


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def wheel_for(files, tag):
    """The manylinux x86_64 wheel for this Python, an abi3 one, or a pure-Python one."""
    best = None
    for f in files:
        n = f["filename"]
        if f["packagetype"] != "bdist_wheel" or f.get("yanked"):
            continue
        if n.endswith("none-any.whl") or (("-" + tag + "-" in n or "-abi3-" in n) and "x86_64" in n and "manylinux" in n):
            best = best if best and "manylinux_2_28" not in n else f
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--python", required=True, help="the runtime's Python, e.g. 3.13")
    a = ap.parse_args()
    tag = "cp" + a.python.replace(".", "")
    env = {"python_version": a.python, "python_full_version": a.python + ".0", "sys_platform": "linux",
           "platform_system": "Linux", "platform_machine": "x86_64", "implementation_name": "cpython",
           "os_name": "posix", "platform_python_implementation": "CPython", "extra": ""}
    spec = {}                                                 # name -> combined version constraint
    queue, chosen = deque(ROOTS), {}
    while queue:
        name = queue.popleft().lower().replace("_", "-")
        if name in chosen:
            continue
        meta = get(f"https://pypi.org/pypi/{name}/json")
        ss = spec.get(name, SpecifierSet())
        pick = None
        for v in sorted((Version(x) for x in meta["releases"] if not Version(x).is_prerelease), reverse=True):
            if v in ss and (w := wheel_for(meta["releases"][str(v)], tag)):
                pick = (str(v), w)
                break
        if not pick:
            raise SystemExit(f"no wheel for {name} {ss} on {tag}")
        chosen[name] = pick
        info = get(f"https://pypi.org/pypi/{name}/{pick[0]}/json")["info"]
        for line in info.get("requires_dist") or []:
            r = Requirement(line)
            if r.marker is not None and not r.marker.evaluate(env):
                continue
            dep = r.name.lower().replace("_", "-")
            spec[dep] = spec.get(dep, SpecifierSet()) & r.specifier
            queue.append(dep)
    sources = [{"type": "file", "url": w["url"], "sha256": w["digests"]["sha256"]} for _, w in chosen.values()]
    print(json.dumps({
        "name": "python-deps",
        "buildsystem": "simple",
        "build-commands": ["pip3 install --verbose --exists-action=i --no-index --find-links=\"file://${PWD}\" "
                           "--prefix=${FLATPAK_DEST} --no-deps " + " ".join(sorted(chosen))],
        "sources": sources}, indent=2))
    print("pinned: " + ", ".join(f"{n} {v}" for n, (v, _) in sorted(chosen.items())), file=sys.stderr)


main()
