"""PodStudio: record a USB mic, fire hotkey sounds, and master to -16 LUFS."""
__version__ = "2026.11.20"      # calendar version, shown as v2026.11.20


def _make_library_lookup_work_in_bundles():
    """ctypes.util.find_library asks ldconfig or gcc, which a Flatpak, Snap or AppImage may not have. Without this,
    soundfile can't find libsndfile and the ALSA gain control can't find libasound. If the normal lookup comes
    back empty, look in the directories the bundle puts on LD_LIBRARY_PATH, then the usual multiarch locations."""
    import ctypes.util
    import glob
    import os

    original = ctypes.util.find_library

    def find_library(name):
        found = original(name)
        if found:
            return found
        dirs = [d for d in os.environ.get("LD_LIBRARY_PATH", "").split(":") if d]
        dirs += ["/app/lib", "/usr/lib/x86_64-linux-gnu", "/usr/lib64", "/usr/lib", "/lib/x86_64-linux-gnu"]
        for d in dirs:
            hits = sorted(glob.glob(os.path.join(d, f"lib{name}.so*")))
            if hits:
                return hits[0]
        return None

    ctypes.util.find_library = find_library


_make_library_lookup_work_in_bundles()
