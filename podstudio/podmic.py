"""RØDE PodMic USB control over USB HID (hidraw) plus the ALSA mixer for gain.

The wire protocol is documented by the podmicusb-doctor project (MIT, (c) 2026 rumkit):
https://github.com/rumkit/podmicusb-doctor  (research/protocol/podmic-usb-hid-spec.md)
The encoder tables in data/podmic-dsp-tables.json come from that project.

PodStudio is not affiliated with or endorsed by RØDE Microphones.
"""
from __future__ import annotations

import glob
import json
import math
import os
import re
import select
import struct
import subprocess
import time
from dataclasses import dataclass
from importlib import resources

VID, PID = 0x19F7, 0x004A

# Report IDs (spec section 4)
R_SVC, R_DSP, R_ACC, R_PARAM = 0x02, 0x04, 0x06, 0x08
REPLY = {R_SVC: 0x01, R_DSP: 0x03, R_ACC: 0x05, R_PARAM: 0x07}
SIZE = {R_SVC: 10, R_DSP: 29, R_ACC: 15, R_PARAM: 28}

# DSP block targets
COMP, GATE, EXCITER, BOTTOM = 0, 1, 2, 3

OP_SET, OP_GET = 0x02, 0x03          # report 4
P_SET, P_GET = 0x00, 0x01            # report 8

# Single parameter ids (report 8)
P_HPF, P_MONITOR, P_MONMIX, P_MUTE = 0x01, 0x03, 0x04, 0x08
P_ADVANCED, P_SLIDER, P_PROCESSING = 0x0B, 0x0C, 0x0D


class PodMicError(Exception):
    pass


class PodMicAccessDenied(PodMicError):
    """hidraw node exists but this user may not open it (udev rule missing)."""


# --------------------------------------------------------------------------- encoders (pure)

_tables: dict[str, list[int]] | None = None


def tables() -> dict[str, list[int]]:
    global _tables
    if _tables is None:
        raw = json.loads(resources.files("podstudio").joinpath("data/podmic-dsp-tables.json").read_text())
        _tables = {k: [int(x, 16) for x in v["values"]] for k, v in raw["tables"].items()}
    return _tables


def _clamp(x, lo, hi):
    return max(lo, min(hi, x))


def q31(x: float) -> int:
    """Signed Q31, saturating at 1.0 (spec 10)."""
    return min(int(x * 2**31), 0x7FFFFFFF)


def u32(v: int) -> bytes:
    return struct.pack("<I", v & 0xFFFFFFFF)


def i32(v: int) -> bytes:
    return struct.pack("<i", v)


def idx_thr(db): return _clamp(int((1 - (db + 60) / 60) * 255), 0, 255)
def idx_att(ms): return _clamp(int(math.log10(ms / 0.1) / math.log10(100) * 255), 0, 255)
def idx_rel(ms): return _clamp(int(math.log10(ms / 5) / math.log10(40) * 255), 0, 255)
def idx_gain(db): return _clamp(int(db / 9 * 255), 0, 255)
def coarse_pct(pct): return _clamp(int(pct / 100 * 255), 0, 255)
def coarse_exc_hz(hz): return _clamp(int((hz - 600) / 4400 * 255), 0, 255)
def coarse_bb_hz(hz): return _clamp(int((hz - 60) / 252 * 255), 0, 255)


def gate_thr_or_range(db): return i32(q31(10 ** (db / 20)))
def gate_hold_or_release(seconds): return i32(q31(1 / (48000 * seconds)))
def gate_hyst(pct): return i32(q31(10 ** ((-1 - 7 * (pct / 100)) / 20)))


def gate_attack(ms):
    w = 5 / (48000 * (ms / 1000))
    c = math.cos(w)
    return i32(q31(c - 1 + math.sqrt(c * c - 4 * c + 3)))


def dsp_report(target: int, op: int, sub: int, payload: bytes = b"") -> bytes:
    body = bytes([target, op, sub]) + payload
    return bytes([R_DSP]) + body.ljust(SIZE[R_DSP] - 1, b"\0")


def param_report(param: int, op: int, *args: int) -> bytes:
    body = bytes([param, op, *args])
    return bytes([R_PARAM]) + body.ljust(SIZE[R_PARAM] - 1, b"\0")


# Field encoders: (target, sub) -> callable(value) -> payload bytes
def _enc_table(name, idx):
    return lambda v: u32(tables()[name][idx(v)])


def _enc_hd(pct):
    b = coarse_pct(pct)
    return u32(tables()["T_hd"][b]) + bytes([b])


def _enc_exc_tune(hz):
    b = coarse_exc_hz(hz)
    return u32(tables()["T_tuneA"][b]) + u32(tables()["T_tuneB"][b]) + bytes([b])


ENCODERS = {
    ("comp", "threshold"): (COMP, 0x01, _enc_table("T_thr", idx_thr)),
    ("comp", "ratio"): (COMP, 0x02, lambda r: bytes([_clamp(int((r - 1.5) / 3 * 255), 0, 255)])),
    ("comp", "attack"): (COMP, 0x03, _enc_table("T_att", idx_att)),
    ("comp", "release"): (COMP, 0x04, _enc_table("T_rel", idx_rel)),
    ("comp", "gain"): (COMP, 0x05, _enc_table("T_gain", idx_gain)),
    ("gate", "threshold"): (GATE, 0x01, gate_thr_or_range),
    ("gate", "attack"): (GATE, 0x02, gate_attack),
    ("gate", "hold"): (GATE, 0x03, gate_hold_or_release),
    ("gate", "release"): (GATE, 0x04, gate_hold_or_release),
    ("gate", "range"): (GATE, 0x05, gate_thr_or_range),
    ("gate", "hysteresis"): (GATE, 0x06, gate_hyst),
    ("exciter", "harmonics"): (EXCITER, 0x01, _enc_hd),
    ("exciter", "tune"): (EXCITER, 0x02, _enc_exc_tune),
    ("bottom", "drive"): (BOTTOM, 0x01, _enc_hd),
    ("bottom", "tune"): (BOTTOM, 0x02, lambda hz: bytes([coarse_bb_hz(hz)])),
}
BLOCKS = {"comp": COMP, "gate": GATE, "exciter": EXCITER, "bottom": BOTTOM}

# Factory defaults (spec 11.2), used as UI starting values when a read fails
DEFAULTS = {
    ("comp", "threshold"): -24.9, ("comp", "ratio"): 1.99, ("comp", "attack"): 0.69,
    ("comp", "release"): 20.9, ("comp", "gain"): 1.98,
    ("gate", "threshold"): -38.0, ("gate", "attack"): 30.0, ("gate", "hold"): 0.305,
    ("gate", "release"): 0.2, ("gate", "range"): -9.0, ("gate", "hysteresis"): 20.0,
    ("exciter", "harmonics"): 69.8, ("exciter", "tune"): 3499.0,
    ("bottom", "drive"): 64.7, ("bottom", "tune"): 90.0,
}


def basic_to_advanced(depth: float, sparkle: float, punch: float) -> list[tuple[str, str, float]]:
    """Depth/Sparkle/Punch (0-100) to advanced writes, exactly as RØDE Central does (spec 9)."""
    p = punch / 100
    return [
        ("bottom", "drive", 0.9 * depth),
        ("exciter", "harmonics", 0.9 * sparkle),
        ("comp", "threshold", -14 - 16 * p),
        ("comp", "gain", 3 * p),
        ("gate", "threshold", 10 * p - 45),
        ("gate", "range", -13 * p),
    ]


def hpf_biquad_request(slot, f0, q=1 / math.sqrt(2), fs=48000, s=1) -> bytes:
    """Custom high-pass in a raw biquad slot (spec 5.5; runtime only, not persisted)."""
    w = 2 * math.pi * f0 / fs
    alpha = math.sin(w) / (2 * q)
    a0 = 1 + alpha
    b0 = (1 + math.cos(w)) / 2 / a0
    coeffs = [b0, -2 * b0, b0, 2 * math.cos(w) / a0, -(1 - alpha) / a0]
    raw = [round(c * 2**31 / 2**s) for c in coeffs]
    body = bytes([0x07, P_SET, slot, 0, 0, 0]) + struct.pack("<5i", *raw) + bytes([s])
    return bytes([R_PARAM]) + body


# --------------------------------------------------------------------------- decoders (pure)


def _lookup(name: str, raw: int) -> int | None:
    t = tables()[name]
    try:
        return t.index(raw)
    except ValueError:
        # nearest entry (tolerates tiny float differences)
        return min(range(256), key=lambda i: abs(t[i] - raw))


def _gate_attack_ms(raw: int) -> float:
    x = raw / 2**31
    lo, hi = 0.1, 1000.0
    for _ in range(60):                      # x falls as ms rises, so bisect on log scale
        mid = math.sqrt(lo * hi)
        w = 5 / (48000 * mid / 1000)
        c = math.cos(w)
        if (c - 1 + math.sqrt(max(c * c - 4 * c + 3, 0))) > x:
            lo = mid
        else:
            hi = mid
    return round(math.sqrt(lo * hi), 2)


def decode_field(block: str, field: str, data: bytes) -> float | None:
    """Inverse of ENCODERS for a GET reply's value bytes."""
    data = bytes(data).ljust(16, b"\0")
    try:
        u = struct.unpack_from("<I", data, 0)[0]
        s = struct.unpack_from("<i", data, 0)[0]
        key = (block, field)
        if key == ("comp", "threshold"): return round((1 - _lookup("T_thr", u) / 255) * 60 - 60, 1)
        if key == ("comp", "ratio"): return round(1.5 + data[0] / 255 * 3, 2)
        if key == ("comp", "attack"): return round(0.1 * 10 ** (_lookup("T_att", u) / 255 * 2), 2)
        if key == ("comp", "release"): return round(5 * 40 ** (_lookup("T_rel", u) / 255), 1)
        if key == ("comp", "gain"): return round(_lookup("T_gain", u) / 255 * 9, 1)
        if key in (("gate", "threshold"), ("gate", "range")):
            return round(20 * math.log10(max(s, 1) / 2**31), 1)
        if key == ("gate", "attack"): return _gate_attack_ms(s)
        if key in (("gate", "hold"), ("gate", "release")): return round(1 / (48000 * max(s, 1) / 2**31), 3)
        if key == ("gate", "hysteresis"):
            return round(max(0.0, min(100.0, (-20 * math.log10(max(s, 1) / 2**31) - 1) / 7 * 100)), 0)
        if key in (("exciter", "harmonics"), ("bottom", "drive")): return round(data[4] / 255 * 100, 1)
        if key == ("exciter", "tune"): return round(600 + data[8] / 255 * 4400)
        if key == ("bottom", "tune"): return round(60 + data[0] / 255 * 252)
    except (struct.error, IndexError):
        pass
    return None


# --------------------------------------------------------------------------- device


HIDIOCGRAWINFO = 0x80084803            # struct hidraw_devinfo { u32 bustype; s16 vendor; s16 product; }


def _hidraw_by_ioctl() -> str | None:
    """Ask each /dev/hidraw* node who it is. Needed in sandboxes where /sys/class/hidraw isn't visible."""
    import fcntl
    for node in sorted(glob.glob("/dev/hidraw*")):
        try:
            fd = os.open(node, os.O_RDONLY | os.O_NONBLOCK)
        except OSError:
            continue
        try:
            _bus, vendor, product = struct.unpack("Ihh", fcntl.ioctl(fd, HIDIOCGRAWINFO, bytes(8)))
            if (vendor & 0xFFFF, product & 0xFFFF) == (VID, PID):
                return node
        except OSError:
            pass
        finally:
            os.close(fd)
    return None


def find_hidraw() -> str | None:
    for node in sorted(glob.glob("/sys/class/hidraw/hidraw*")):
        try:
            uevent = open(os.path.join(node, "device/uevent")).read()
        except OSError:
            continue
        m = re.search(r"HID_ID=\w+:0*([0-9A-Fa-f]+):0*([0-9A-Fa-f]+)", uevent)
        if m and int(m.group(1), 16) == VID and int(m.group(2), 16) == PID:
            return "/dev/" + os.path.basename(node)
    return _hidraw_by_ioctl()


def find_alsa_card() -> str | None:
    """ALSA card index for the mic (matched on the USB id in /proc/asound)."""
    try:
        for line in open("/proc/asound/cards"):
            m = re.match(r"\s*(\d+)\s+\[", line)
            if m:
                idx = m.group(1)
                try:
                    usbid = open(f"/proc/asound/card{idx}/usbid").read().strip().lower()
                except OSError:
                    continue
                if usbid == f"{VID:04x}:{PID:04x}":
                    return idx
    except OSError:
        pass
    return None


@dataclass
class Reply:
    status: str
    data: bytes  # value bytes (after the status byte)


class PodMic:
    def __init__(self, path: str | None = None):
        self.path = path or find_hidraw()
        self.fd: int | None = None

    # -- connection
    @staticmethod
    def present() -> bool:
        return find_hidraw() is not None

    def open(self):
        if not self.path:
            raise PodMicError("PodMic USB not found")
        try:
            self.fd = os.open(self.path, os.O_RDWR | os.O_NONBLOCK)
        except PermissionError as e:
            raise PodMicAccessDenied(self.path) from e
        except OSError as e:
            raise PodMicError(str(e)) from e

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, *a):
        self.close()

    # -- transport
    def _drain(self):
        while select.select([self.fd], [], [], 0)[0]:
            try:
                os.read(self.fd, 64)
            except BlockingIOError:
                break

    def _xfer(self, report: bytes, timeout=1.0) -> Reply:
        if self.fd is None:
            raise PodMicError("not open")
        self._drain()
        os.write(self.fd, report)
        want = REPLY[report[0]]
        deadline = time.monotonic() + timeout
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                raise PodMicError("timeout waiting for reply")
            if select.select([self.fd], [], [], left)[0]:
                try:
                    data = os.read(self.fd, 64)
                except BlockingIOError:
                    continue
                if data and data[0] == want:
                    return Reply(chr(data[2]) if len(data) > 2 else "?", bytes(data[3:]))

    def _ok(self, rep: Reply, what: str) -> Reply:
        if rep.status != "A":
            raise PodMicError(f"{what}: device answered {rep.status!r}")
        return rep

    # -- single parameters
    def set_param(self, param: int, *args: int):
        self._ok(self._xfer(param_report(param, P_SET, *args)), f"set 0x{param:02x}")

    def get_param(self, param: int, *args: int) -> bytes:
        return self._ok(self._xfer(param_report(param, P_GET, *args)), f"get 0x{param:02x}").data

    def hpf(self) -> bool: return bool(self.get_param(P_HPF)[0])
    def set_hpf(self, on: bool): self.set_param(P_HPF, int(on))
    def muted(self) -> bool: return bool(self.get_param(P_MUTE)[0])
    def set_mute(self, on: bool): self.set_param(P_MUTE, int(on))
    def monitoring(self) -> bool: return bool(self.get_param(P_MONITOR)[0])
    def set_monitoring(self, on: bool): self.set_param(P_MONITOR, int(on))
    def monitor_mix(self) -> int: return self.get_param(P_MONMIX)[0]
    def set_monitor_mix(self, v: int): self.set_param(P_MONMIX, _clamp(int(v), 0, 100))
    def processing(self) -> bool: return bool(self.get_param(P_PROCESSING)[0])
    def set_processing(self, on: bool): self.set_param(P_PROCESSING, int(on))
    def advanced(self) -> bool: return bool(self.get_param(P_ADVANCED)[0])
    def set_advanced(self, on: bool): self.set_param(P_ADVANCED, int(on))

    def slider(self, idx: int) -> int:
        return self.get_param(P_SLIDER, idx)[1]          # reply is [index, value]

    def set_slider(self, idx: int, pct: int):
        self.set_param(P_SLIDER, idx, _clamp(int(pct), 0, 100))

    # -- DSP blocks
    def set_enabled(self, block: str, on: bool):
        rep = self._xfer(dsp_report(BLOCKS[block], OP_SET, 0x00, bytes([int(on)])))
        self._ok(rep, f"enable {block}")

    def enabled(self, block: str) -> bool:
        rep = self._xfer(dsp_report(BLOCKS[block], OP_GET, 0x00))
        return bool(self._ok(rep, f"enabled {block}").data[0])

    def set_field(self, block: str, field: str, value: float):
        target, sub, enc = ENCODERS[(block, field)]
        rep = self._xfer(dsp_report(target, OP_SET, sub, enc(value)))
        self._ok(rep, f"set {block}.{field}")

    def read_field(self, block: str, field: str) -> float | None:
        """Read a DSP field back and decode it to UI units (None if unreadable)."""
        target, sub, _ = ENCODERS[(block, field)]
        try:
            rep = self._ok(self._xfer(dsp_report(target, OP_GET, sub)), f"read {block}.{field}")
        except PodMicError:
            return None
        return decode_field(block, field, rep.data)

    def apply_basic(self, depth: float, sparkle: float, punch: float):
        """Mirror RØDE Central's Basic mode: store sliders, then write the advanced fields."""
        for i, v in enumerate((depth, sparkle, punch)):
            self.set_slider(i, v)
        self.set_enabled("bottom", True)
        self.set_enabled("exciter", True)
        self.set_enabled("comp", True)
        self.set_enabled("gate", True)
        for block, field, v in basic_to_advanced(depth, sparkle, punch):
            self.set_field(block, field, v)

    def read_state(self) -> dict:
        """Best-effort snapshot for the UI; each item falls back to None on error."""
        out: dict = {}

        def grab(key, fn):
            try:
                out[key] = fn()
            except PodMicError:
                out[key] = None

        grab("hpf", self.hpf)
        grab("mute", self.muted)
        grab("monitoring", self.monitoring)
        grab("monitor_mix", self.monitor_mix)
        grab("processing", self.processing)
        grab("advanced", self.advanced)
        for i, name in enumerate(("depth", "sparkle", "punch")):
            grab(name, lambda i=i: self.slider(i))
        for b in BLOCKS:
            grab(f"{b}_on", lambda b=b: self.enabled(b))
        return out


# --------------------------------------------------------------------------- input gain (ALSA)


def get_gain_db(card: str | None = None) -> float | None:
    card = card or find_alsa_card()
    if card is None:
        return None
    try:
        from . import alsa_gain
        db = alsa_gain.get_capture_db(int(card))
        if db is not None:
            return db
    except (OSError, ValueError):
        pass
    try:                                                   # fall back to the amixer tool where it exists
        out = subprocess.run(["amixer", "-c", card, "sget", "Mic", "Capture"],
                             capture_output=True, text=True, timeout=3).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(r"\[(-?[\d.]+)dB\]", out)
    return float(m.group(1)) if m else None


def set_gain_db(db: float, card: str | None = None) -> bool:
    card = card or find_alsa_card()
    if card is None:
        return False
    db = _clamp(db, 22.0, 63.0)
    try:
        from . import alsa_gain
        if alsa_gain.set_capture_db(int(card), db):
            return True
    except (OSError, ValueError):
        pass
    try:
        r = subprocess.run(["amixer", "-c", card, "sset", "Mic", "Capture", f"{db:.1f}dB"],
                           capture_output=True, text=True, timeout=3)
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False
