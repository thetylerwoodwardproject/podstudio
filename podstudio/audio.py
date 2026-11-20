"""GStreamer audio: mic metering/recording, clip playback and clip import."""
from __future__ import annotations

import math
import subprocess
from pathlib import Path

import gi

gi.require_version("Gst", "1.0")
from gi.repository import GLib, Gst  # noqa: E402

from .project import SAMPLE_RATE  # noqa: E402

Gst.init(None)


PODMIC_VENDOR, PODMIC_PRODUCT = "0x19f7", "0x004a"


def find_podmic_source() -> str | None:
    """PulseAudio/PipeWire source name of the RØDE PodMic USB, or None. PodStudio supports no other input."""
    import json
    try:
        out = subprocess.run(["pactl", "-f", "json", "list", "sources"],
                             capture_output=True, text=True, timeout=4).stdout
        items = json.loads(out)
    except Exception:
        return None
    for s in items:
        name = s.get("name", "")
        if name.endswith(".monitor"):
            continue
        props = s.get("properties") or {}
        ids = (str(props.get("device.vendor.id", "")).lower(), str(props.get("device.product.id", "")).lower())
        if ids == (PODMIC_VENDOR, PODMIC_PRODUCT) or "podmic" in name.lower():
            return name
    return None


def repair_wav_header(path: Path) -> float:
    """Fix the sizes of a WAV whose writer never finished (unplugged mic, crash). Returns duration in seconds."""
    import struct
    with open(path, "r+b") as f:
        head = f.read(12)
        if len(head) < 12 or head[:4] != b"RIFF" or head[8:12] != b"WAVE":
            raise ValueError("not a WAV file")
        total = f.seek(0, 2)
        f.seek(12)
        rate, block, data_at = SAMPLE_RATE, 3, None
        while f.tell() + 8 <= total:
            pos = f.tell()
            cid, size = struct.unpack("<4sI", f.read(8))
            if cid == b"fmt ":
                fmt = f.read(min(size, 16))
                _, ch, rate, _, block, _ = struct.unpack("<HHIIHH", fmt)
                f.seek(pos + 8 + size + (size & 1))
            elif cid == b"data":
                data_at = pos
                break
            else:
                f.seek(pos + 8 + size + (size & 1))
        if data_at is None:
            raise ValueError("no audio data")
        nbytes = (total - (data_at + 8)) // block * block      # whole sample frames only
        f.seek(data_at + 4)
        f.write(struct.pack("<I", nbytes))
        f.seek(4)
        f.write(struct.pack("<I", data_at + 8 + nbytes - 8))
        f.truncate(data_at + 8 + nbytes)
        return nbytes / block / rate


def _level_db(structure, key="rms") -> list[float]:
    try:
        arr = structure.get_value(key)
        return [float(v) for v in arr]
    except Exception:
        return []


class MicEngine:
    """One pipeline for both idle metering and recording.

    on_level(rms_db, peak_db) is called on the GLib main loop ~20 times a second.
    """

    def __init__(self, on_level=None, on_error=None):
        self.on_level = on_level
        self.on_error = on_error
        self.pipeline: Gst.Pipeline | None = None
        self.recording = False
        self._first_pts: int | None = None
        self._eos_cb = None
        self._source: str | None = None
        self.gain_db = 0.0            # mic fader: applied to the meter (post-fader); recorded audio stays clean

    # -- control ------------------------------------------------------------
    def start_meter(self, source: str | None):
        self.stop()
        self._source = source
        if not source:
            return
        desc = (
            f"pulsesrc device={source} ! audio/x-raw,rate={SAMPLE_RATE},channels=1 ! audioconvert ! "
            "volume name=vol ! level name=lvl interval=50000000 post-messages=true peak-ttl=300000000 ! "
            "fakesink sync=false"
        )
        self._launch(desc)

    def start_recording(self, source: str | None, path: Path):
        self.stop()
        self._source = source
        self._first_pts = None
        if not source:
            return
        # tee: the file gets the raw mic; the meter branch goes through the fader
        desc = (
            f"pulsesrc device={source} ! audio/x-raw,rate={SAMPLE_RATE},channels=1 ! audioconvert ! tee name=t "
            "t. ! queue ! volume name=vol ! level name=lvl interval=50000000 post-messages=true "
            "peak-ttl=300000000 ! fakesink sync=false "
            f"t. ! queue ! audioconvert ! audio/x-raw,format=S24LE,rate={SAMPLE_RATE},channels=1 ! "
            f"wavenc name=enc ! filesink location=\"{path}\""
        )
        self._launch(desc)
        if self.pipeline is None:
            return
        enc = self.pipeline.get_by_name("enc")
        enc.get_static_pad("sink").add_probe(Gst.PadProbeType.BUFFER, self._first_buffer)
        self.recording = True

    def set_gain_db(self, db: float):
        """Mic fader. Takes effect immediately on the running pipeline and on every later one."""
        self.gain_db = db
        self._apply_gain()

    def _apply_gain(self):
        if self.pipeline is not None:
            vol = self.pipeline.get_by_name("vol")
            if vol is not None:
                vol.set_property("volume", 0.0 if self.gain_db <= -60 else 10 ** (self.gain_db / 20))

    def stop_recording(self, done=None):
        """Finalise the WAV header via EOS, then call done()."""
        if not self.pipeline or not self.recording:
            if done:
                done()
            return
        self._eos_cb = done
        self.pipeline.send_event(Gst.Event.new_eos())

    def stop(self):
        if self.pipeline:
            self.pipeline.set_state(Gst.State.NULL)
            self.pipeline = None
        self.recording = False

    # -- timeline ----------------------------------------------------------------
    def position(self) -> float | None:
        """Seconds of audio recorded so far, on the same timeline as the WAV."""
        if not (self.pipeline and self.recording and self._first_pts is not None):
            return None
        clock = self.pipeline.get_clock()
        if clock is None:
            return None
        running = clock.get_time() - self.pipeline.get_base_time()
        return max(0.0, (running - self._first_pts) / Gst.SECOND)

    # -- internals ---------------------------------------------------------------
    def _first_buffer(self, pad, info):
        buf = info.get_buffer()
        if self._first_pts is None and buf is not None and buf.pts != Gst.CLOCK_TIME_NONE:
            self._first_pts = buf.pts
            return Gst.PadProbeReturn.REMOVE
        return Gst.PadProbeReturn.OK

    def _launch(self, desc: str):
        try:
            self.pipeline = Gst.parse_launch(desc)
        except GLib.Error as e:
            self.pipeline = None
            if self.on_error:
                self.on_error(str(e))
            return
        bus = self.pipeline.get_bus()
        bus.add_signal_watch()
        bus.connect("message", self._on_message)
        self._apply_gain()
        self.pipeline.set_state(Gst.State.PLAYING)

    def _on_message(self, bus, msg):
        t = msg.type
        if t == Gst.MessageType.ELEMENT:
            s = msg.get_structure()
            if s and s.get_name() == "level" and self.on_level:
                rms, peak = _level_db(s, "rms"), _level_db(s, "peak")
                if rms and peak:
                    self.on_level(max(rms), max(peak))
        elif t == Gst.MessageType.EOS:
            cb, self._eos_cb = self._eos_cb, None
            self.stop()
            if cb:
                cb()
        elif t == Gst.MessageType.ERROR:
            err, dbg = msg.parse_error()
            was_recording = self.recording
            self.stop()
            if self.on_error:
                self.on_error(err.message, was_recording)


class ClipPlayer:
    """Fire-and-forget polyphonic clip playback to the default output."""

    def __init__(self):
        self._live: set[Gst.Pipeline] = set()

    def play(self, path: Path, gain_db: float = 0.0, sink: str = "pulsesink"):
        vol = 10 ** (gain_db / 20)
        desc = (f"filesrc location=\"{path}\" ! decodebin ! audioconvert ! audioresample ! "
                f"volume volume={vol:.5f} ! {sink}")
        try:
            pipe = Gst.parse_launch(desc)
        except GLib.Error:
            return
        bus = pipe.get_bus()
        bus.add_signal_watch()

        def on_msg(_bus, msg):
            if msg.type in (Gst.MessageType.EOS, Gst.MessageType.ERROR):
                pipe.set_state(Gst.State.NULL)
                self._live.discard(pipe)

        bus.connect("message", on_msg)
        self._live.add(pipe)
        pipe.set_state(Gst.State.PLAYING)

    def stop_all(self):
        for p in list(self._live):
            p.set_state(Gst.State.NULL)
        self._live.clear()


def import_clip(src: Path, dst: Path, timeout_s: float = 60.0) -> None:
    """Convert any playable audio file to a 48 kHz stereo 24-bit WAV (blocking)."""
    desc = (f"filesrc location=\"{src}\" ! decodebin ! audioconvert ! audioresample ! "
            f"audio/x-raw,format=S24LE,rate={SAMPLE_RATE},channels=2 ! wavenc ! filesink location=\"{dst}\"")
    pipe = Gst.parse_launch(desc)
    pipe.set_state(Gst.State.PLAYING)
    bus = pipe.get_bus()
    msg = bus.timed_pop_filtered(int(timeout_s * Gst.SECOND), Gst.MessageType.EOS | Gst.MessageType.ERROR)
    pipe.set_state(Gst.State.NULL)
    if msg is None:
        raise RuntimeError("import timed out")
    if msg.type == Gst.MessageType.ERROR:
        raise RuntimeError(msg.parse_error()[0].message)


def encode_mp3(src_wav: Path, dst: Path, title: str = "", bitrate: int = 128, timeout_s: float = 600.0) -> None:
    """Encode a WAV to a constant-bitrate stereo MP3 at the source sample rate (blocking)."""
    desc = (f"filesrc location=\"{src_wav}\" ! decodebin ! audioconvert ! audioresample ! "
            f"audio/x-raw,channels=2 ! lamemp3enc name=enc target=bitrate cbr=true bitrate={bitrate} ! "
            f"id3v2mux name=tags ! filesink location=\"{dst}\"")
    pipe = Gst.parse_launch(desc)
    if title:
        tl = Gst.TagList.new_empty()
        tl.add_value(Gst.TagMergeMode.REPLACE, Gst.TAG_TITLE, title)
        pipe.get_by_name("tags").merge_tags(tl, Gst.TagMergeMode.REPLACE)
    pipe.set_state(Gst.State.PLAYING)
    msg = pipe.get_bus().timed_pop_filtered(int(timeout_s * Gst.SECOND), Gst.MessageType.EOS | Gst.MessageType.ERROR)
    pipe.set_state(Gst.State.NULL)
    if msg is None:
        raise RuntimeError("MP3 export timed out")
    if msg.type == Gst.MessageType.ERROR:
        raise RuntimeError(msg.parse_error()[0].message)


def meter_fraction(db: float, floor: float = -60.0) -> float:
    """Map dBFS to 0..1 for drawing."""
    if not math.isfinite(db):
        return 0.0
    return max(0.0, min(1.0, (db - floor) / -floor))
