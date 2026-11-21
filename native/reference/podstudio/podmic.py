"""RØDE PodMic USB control protocol (reference implementation used to test the C++ code in native/core/podmic.cpp).

The wire protocol is documented by the podmicusb-doctor project (MIT, (c) 2026 rumkit):
https://github.com/rumkit/podmicusb-doctor  (research/protocol/podmic-usb-hid-spec.md)
The encoder tables in data/podmic-dsp-tables.json come from that project.

PodStudio is not affiliated with or endorsed by RØDE Microphones.
"""
from __future__ import annotations

import json
import math
import struct
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
