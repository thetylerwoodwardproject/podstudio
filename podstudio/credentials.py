"""Buzzsprout API token in the desktop keyring (libsecret). It is never written to a plain file."""
from __future__ import annotations

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
