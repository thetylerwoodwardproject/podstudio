"""Buzzsprout API token in the system credential store. It is never written to a plain file.

Linux uses the desktop keyring (libsecret). Windows uses Credential Manager, the same place Windows keeps saved
network and app passwords, through advapi32.
"""
from __future__ import annotations

import sys

_TARGET = "PodStudio: Buzzsprout API token"
_WIN = sys.platform == "win32"

if _WIN:
    import ctypes
    from ctypes import wintypes

    _CRED_TYPE_GENERIC, _CRED_PERSIST_LOCAL_MACHINE = 1, 2

    class _CREDENTIAL(ctypes.Structure):
        _fields_ = [("Flags", wintypes.DWORD), ("Type", wintypes.DWORD), ("TargetName", wintypes.LPWSTR),
                    ("Comment", wintypes.LPWSTR), ("LastWritten", wintypes.FILETIME),
                    ("CredentialBlobSize", wintypes.DWORD), ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
                    ("Persist", wintypes.DWORD), ("AttributeCount", wintypes.DWORD), ("Attributes", ctypes.c_void_p),
                    ("TargetAlias", wintypes.LPWSTR), ("UserName", wintypes.LPWSTR)]

    def _advapi():
        lib = ctypes.WinDLL("advapi32", use_last_error=True)
        lib.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.POINTER(_CREDENTIAL))]
        lib.CredReadW.restype = wintypes.BOOL
        lib.CredWriteW.argtypes = [ctypes.POINTER(_CREDENTIAL), wintypes.DWORD]
        lib.CredWriteW.restype = wintypes.BOOL
        lib.CredDeleteW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
        lib.CredDeleteW.restype = wintypes.BOOL
        lib.CredFree.argtypes = [ctypes.c_void_p]
        lib.CredFree.restype = None
        return lib

    def available() -> bool:
        return True

    def load() -> str | None:
        try:
            lib, out = _advapi(), ctypes.POINTER(_CREDENTIAL)()
            if not lib.CredReadW(_TARGET, _CRED_TYPE_GENERIC, 0, ctypes.byref(out)):
                return None
            try:
                c = out.contents
                return ctypes.string_at(c.CredentialBlob, c.CredentialBlobSize).decode("utf-16-le") or None
            finally:
                lib.CredFree(out)
        except (OSError, ValueError, AttributeError):
            return None

    def store(token: str) -> bool:
        """True if Credential Manager accepted it. If not, the caller keeps the token in memory for this session."""
        try:
            blob = token.encode("utf-16-le")
            buf = (ctypes.c_ubyte * len(blob)).from_buffer_copy(blob)
            cred = _CREDENTIAL()
            cred.Type, cred.TargetName, cred.UserName = _CRED_TYPE_GENERIC, _TARGET, "PodStudio"
            cred.CredentialBlobSize, cred.CredentialBlob = len(blob), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte))
            cred.Persist = _CRED_PERSIST_LOCAL_MACHINE
            return bool(_advapi().CredWriteW(ctypes.byref(cred), 0))
        except (OSError, ValueError, AttributeError):
            return False

    def clear() -> None:
        try:
            _advapi().CredDeleteW(_TARGET, _CRED_TYPE_GENERIC, 0)
        except (OSError, AttributeError):
            pass

else:
    import gi

    try:
        gi.require_version("Secret", "1")
        from gi.repository import GLib, Secret
        _SCHEMA = Secret.Schema.new("io.github.thetylerwoodwardproject.PodStudio", Secret.SchemaFlags.NONE,
                                    {"service": Secret.SchemaAttributeType.STRING})
        _OK = True
    except (ValueError, ImportError):
        _OK = False

    _ATTRS = {"service": "buzzsprout-api-token"}

    def available() -> bool:
        return _OK

    def load() -> str | None:
        if not _OK:
            return None
        try:
            return Secret.password_lookup_sync(_SCHEMA, _ATTRS, None)
        except GLib.Error:
            return None

    def store(token: str) -> bool:
        """True if the keyring accepted it. If not, the caller keeps the token in memory for this session only."""
        if not _OK:
            return False
        try:
            return bool(Secret.password_store_sync(_SCHEMA, _ATTRS, Secret.COLLECTION_DEFAULT,
                                                   "PodStudio: Buzzsprout API token", token, None))
        except GLib.Error:
            return False

    def clear() -> None:
        if _OK:
            try:
                Secret.password_clear_sync(_SCHEMA, _ATTRS, None)
            except GLib.Error:
                pass
