"""PodMic input gain through ALSA's own library, so no `amixer` binary is needed (sandboxed formats don't ship one)."""
from __future__ import annotations

import ctypes
import ctypes.util
import re

VID, PID = 0x19F7, 0x004A
_lib = None


def _asound():
    global _lib
    if _lib is None:
        name = ctypes.util.find_library("asound")
        if not name:
            raise OSError("libasound not found")
        a = ctypes.CDLL(name)
        vp, lp = ctypes.c_void_p, ctypes.POINTER(ctypes.c_long)
        a.snd_mixer_find_selem.restype = vp
        a.snd_mixer_find_selem.argtypes = [vp, vp]
        a.snd_mixer_selem_get_capture_dB.argtypes = [vp, ctypes.c_int, lp]
        a.snd_mixer_selem_get_capture_dB_range.argtypes = [vp, lp, lp]
        a.snd_mixer_selem_set_capture_dB_all.argtypes = [vp, ctypes.c_long, ctypes.c_int]
        a.snd_mixer_selem_id_set_name.argtypes = [vp, ctypes.c_char_p]
        a.snd_mixer_selem_id_set_index.argtypes = [vp, ctypes.c_uint]
        a.snd_mixer_attach.argtypes = [vp, ctypes.c_char_p]
        a.snd_mixer_selem_register.argtypes = [vp, vp, vp]
        _lib = a
    return _lib


def find_card(usbid: tuple[int, int] = (VID, PID), proc: str = "/proc/asound") -> int | None:
    """ALSA card index of the USB device, read from /proc/asound (present in every sandbox that exposes sound)."""
    want = f"{usbid[0]:04x}:{usbid[1]:04x}"
    try:
        for line in open(f"{proc}/cards"):
            m = re.match(r"\s*(\d+)\s+\[", line)
            if m:
                try:
                    if open(f"{proc}/card{m.group(1)}/usbid").read().strip().lower() == want:
                        return int(m.group(1))
                except OSError:
                    continue
    except OSError:
        pass
    return None


class _Mixer:
    """Open the mixer of one card and find one simple control. Always closed again."""

    def __init__(self, card: int, control: str):
        self.card, self.control, self.mixer, self.sid, self.elem = card, control, ctypes.c_void_p(), ctypes.c_void_p(), None

    def __enter__(self):
        a = _asound()
        if a.snd_mixer_open(ctypes.byref(self.mixer), 0) != 0:
            raise OSError("can't open the ALSA mixer")
        try:
            if (a.snd_mixer_attach(self.mixer, f"hw:{self.card}".encode()) != 0 or a.snd_mixer_selem_register(self.mixer, None, None) != 0
                    or a.snd_mixer_load(self.mixer) != 0):
                raise OSError("can't load the ALSA mixer")
            a.snd_mixer_selem_id_malloc(ctypes.byref(self.sid))
            a.snd_mixer_selem_id_set_index(self.sid, 0)
            a.snd_mixer_selem_id_set_name(self.sid, self.control.encode())
            self.elem = a.snd_mixer_find_selem(self.mixer, self.sid)
            if not self.elem:
                raise OSError(f"no '{self.control}' control")
        except BaseException:
            self.__exit__()
            raise
        return self

    def __exit__(self, *exc):
        a = _asound()
        if self.sid:
            a.snd_mixer_selem_id_free(self.sid)
        if self.mixer:
            a.snd_mixer_close(self.mixer)
        return False


def get_capture_db(card: int, control: str = "Mic") -> float | None:
    try:
        with _Mixer(card, control) as m:
            db = ctypes.c_long()
            if _asound().snd_mixer_selem_get_capture_dB(m.elem, 0, ctypes.byref(db)) != 0:
                return None
            return db.value / 100.0
    except OSError:
        return None


def capture_range_db(card: int, control: str = "Mic") -> tuple[float, float] | None:
    try:
        with _Mixer(card, control) as m:
            lo, hi = ctypes.c_long(), ctypes.c_long()
            if _asound().snd_mixer_selem_get_capture_dB_range(m.elem, ctypes.byref(lo), ctypes.byref(hi)) != 0:
                return None
            return lo.value / 100.0, hi.value / 100.0
    except OSError:
        return None


def set_capture_db(card: int, db: float, control: str = "Mic") -> bool:
    """Set the capture gain to the nearest step. Returns False if the control can't be reached."""
    try:
        with _Mixer(card, control) as m:
            return _asound().snd_mixer_selem_set_capture_dB_all(m.elem, int(round(db * 100)), 0) == 0
    except OSError:
        return False
