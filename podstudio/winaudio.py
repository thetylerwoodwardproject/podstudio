"""Windows only: the PodMic's input gain, through the Windows audio endpoint volume (what the Sound settings page
changes). It is the Windows counterpart of alsa_gain.py. The device is named by its WASAPI endpoint id, which is what
GStreamer reports as the input's `device`.

The PodMic's own gain range is not known from here, so the app's 22 to 63 dB gain slider is mapped linearly onto
whatever range Windows reports; the two are identical when the driver reports the same range.
"""
from __future__ import annotations

UI_MIN_DB, UI_MAX_DB = 22.0, 63.0


def _volume(endpoint_id: str):
    import comtypes
    from comtypes import CLSCTX_ALL, CLSCTX_INPROC_SERVER, CoCreateInstance
    from pycaw.api.endpointvolume import IAudioEndpointVolume
    from pycaw.api.mmdeviceapi import IMMDeviceEnumerator
    from pycaw.constants import CLSID_MMDeviceEnumerator
    try:
        comtypes.CoInitialize()                              # no-op where this thread already did it
    except OSError:
        pass
    enum = CoCreateInstance(CLSID_MMDeviceEnumerator, IMMDeviceEnumerator, CLSCTX_INPROC_SERVER)
    dev = enum.GetDevice(endpoint_id)
    return dev.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None).QueryInterface(IAudioEndpointVolume)


def to_device_db(ui_db: float, lo: float, hi: float) -> float:
    frac = (min(max(ui_db, UI_MIN_DB), UI_MAX_DB) - UI_MIN_DB) / (UI_MAX_DB - UI_MIN_DB)
    return lo + frac * (hi - lo)


def to_ui_db(device_db: float, lo: float, hi: float) -> float:
    if hi <= lo:
        return UI_MIN_DB
    frac = (min(max(device_db, lo), hi) - lo) / (hi - lo)
    return UI_MIN_DB + frac * (UI_MAX_DB - UI_MIN_DB)


def get_capture_db(endpoint_id: str) -> float | None:
    try:
        vol = _volume(endpoint_id)
        lo, hi, _step = vol.GetVolumeRange()
        return to_ui_db(float(vol.GetMasterVolumeLevel()), float(lo), float(hi))
    except Exception:                                        # COM errors, missing comtypes/pycaw, device unplugged
        return None


def set_capture_db(endpoint_id: str, ui_db: float) -> bool:
    try:
        vol = _volume(endpoint_id)
        lo, hi, _step = vol.GetVolumeRange()
        vol.SetMasterVolumeLevel(float(to_device_db(ui_db, float(lo), float(hi))), None)
        return True
    except Exception:
        return False


def describe(endpoint_id: str) -> str:
    try:
        lo, hi, step = _volume(endpoint_id).GetVolumeRange()
        return f"Windows reports a gain range of {lo:.1f} to {hi:.1f} dB in {step:.2f} dB steps"
    except Exception as e:
        return f"unreadable ({type(e).__name__})"
