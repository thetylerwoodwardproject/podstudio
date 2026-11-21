"""A small ctypes binding to the hidapi library (https://github.com/libusb/hidapi), used for the PodMic's USB HID
control channel on Windows, where there is no /dev/hidraw. Only what PodStudio needs: list, open, write, read.

The `hid_device_info` fields used here (path .. interface_number, next) have had the same layout since hidapi 0.9.
"""
from __future__ import annotations

import ctypes
import ctypes.util
import os
from dataclasses import dataclass
from pathlib import Path


class HidError(OSError):
    pass


class _Info(ctypes.Structure):
    pass


_Info._fields_ = [
    ("path", ctypes.c_char_p),
    ("vendor_id", ctypes.c_ushort),
    ("product_id", ctypes.c_ushort),
    ("serial_number", ctypes.c_wchar_p),
    ("release_number", ctypes.c_ushort),
    ("manufacturer_string", ctypes.c_wchar_p),
    ("product_string", ctypes.c_wchar_p),
    ("usage_page", ctypes.c_ushort),
    ("usage", ctypes.c_ushort),
    ("interface_number", ctypes.c_int),
    ("next", ctypes.POINTER(_Info)),
]


@dataclass
class DeviceInfo:
    path: bytes
    vendor_id: int
    product_id: int
    usage_page: int
    usage: int
    interface: int


_lib = None


def _find() -> str | None:
    env = os.environ.get("PODSTUDIO_HIDAPI")
    if env and Path(env).exists():
        return env
    home = os.environ.get("PODSTUDIO_HOME")
    names = ("libhidapi-0.dll", "hidapi.dll", "libhidapi.dll")
    if home:
        for n in names:
            if (Path(home) / "bin" / n).exists():
                return str(Path(home) / "bin" / n)
    for n in ("hidapi", "hidapi-hidraw", "hidapi-libusb"):
        found = ctypes.util.find_library(n)
        if found:
            return found
    for n in names:
        found = ctypes.util.find_library(n[:-4])
        if found:
            return found
    return None


def library():
    """The loaded hidapi library, or raises HidError (not installed)."""
    global _lib
    if _lib is not None:
        return _lib
    path = _find()
    if not path:
        raise HidError("the hidapi library was not found")
    try:
        lib = ctypes.CDLL(path)
    except OSError as e:
        raise HidError(f"couldn't load hidapi: {e}") from e
    lib.hid_init.restype = ctypes.c_int
    lib.hid_enumerate.argtypes = [ctypes.c_ushort, ctypes.c_ushort]
    lib.hid_enumerate.restype = ctypes.POINTER(_Info)
    lib.hid_free_enumeration.argtypes = [ctypes.POINTER(_Info)]
    lib.hid_free_enumeration.restype = None
    lib.hid_open_path.argtypes = [ctypes.c_char_p]
    lib.hid_open_path.restype = ctypes.c_void_p
    lib.hid_close.argtypes = [ctypes.c_void_p]
    lib.hid_close.restype = None
    lib.hid_write.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_size_t]
    lib.hid_write.restype = ctypes.c_int
    lib.hid_read_timeout.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_size_t, ctypes.c_int]
    lib.hid_read_timeout.restype = ctypes.c_int
    lib.hid_init()
    _lib = lib
    return lib


def enumerate_devices(vendor: int, product: int) -> list[DeviceInfo]:
    """Every HID interface of the device with this USB id (a USB device may expose several)."""
    lib = library()
    head = lib.hid_enumerate(vendor, product)
    out: list[DeviceInfo] = []
    try:
        node = head
        while node:
            i = node.contents
            if i.path:
                out.append(DeviceInfo(bytes(i.path), i.vendor_id, i.product_id, i.usage_page, i.usage, i.interface_number))
            node = i.next
    finally:
        if head:
            lib.hid_free_enumeration(head)
    return out


class Device:
    """An open HID interface. Reports are exchanged with the report id as the first byte, as on Linux's hidraw."""

    def __init__(self, path: bytes):
        self._lib = library()
        self._h = self._lib.hid_open_path(path)
        if not self._h:
            raise HidError("couldn't open the HID interface")

    def write(self, data: bytes) -> int:
        n = self._lib.hid_write(self._h, bytes(data), len(data))
        if n < 0:
            raise HidError("write to the HID interface failed")
        return n

    def read(self, timeout_ms: int, size: int = 64) -> bytes | None:
        """One input report, or None if nothing arrived in time."""
        buf = ctypes.create_string_buffer(size)
        n = self._lib.hid_read_timeout(self._h, buf, size, max(0, int(timeout_ms)))
        if n < 0:
            raise HidError("read from the HID interface failed")
        return buf.raw[:n] if n else None

    def close(self):
        if self._h:
            self._lib.hid_close(self._h)
            self._h = None
