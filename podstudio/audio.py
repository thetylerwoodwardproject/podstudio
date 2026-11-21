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


def _gst_source_name(match) -> str | None:
    """Find an input through GStreamer's own device list. Needs no host tools, so it also works in a sandbox.
    `match(name, properties_text)` decides which device is wanted; returns the name pulsesrc should be given."""
    mon = Gst.DeviceMonitor.new()
    mon.add_filter("Audio/Source", None)
    if not mon.start():
        return None
    try:
        for dev in mon.get_devices():
            props = dev.get_properties()
            text = (props.to_string() if props is not None else "") + " " + (dev.get_display_name() or "")
            if match(dev.get_display_name() or "", text.lower()):
                el = dev.create_element(None)
                if el is not None and el.find_property("device") is not None:
                    name = el.get_property("device")
                    if name and not str(name).endswith(".monitor"):
                        return str(name)
    finally:
        mon.stop()
    return None


def _is_podmic(name: str, text: str) -> bool:
    return "podmic" in text or ("0x19f7" in text and "0x004a" in text)


def find_podmic_source() -> str | None:
    """PulseAudio/PipeWire source name of the RØDE PodMic USB, or None. PodStudio supports no other input."""
    import json
    try:
        out = subprocess.run(["pactl", "-f", "json", "list", "sources"],
                             capture_output=True, text=True, timeout=4).stdout
        items = json.loads(out)
    except (OSError, subprocess.SubprocessError, ValueError):
        return _gst_source_name(_is_podmic)                    # no pactl here (Flatpak): ask GStreamer instead
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

    def __init__(self, on_level=None, on_error=None, on_voice=None):
        self.on_voice = on_voice          # pre-fader mic RMS, for ducking
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
            "level name=pre interval=50000000 post-messages=true ! "
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
            "t. ! queue ! level name=pre interval=50000000 post-messages=true ! volume name=vol ! level name=lvl interval=50000000 post-messages=true "
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
            if s and s.get_name() == "level":
                rms, peak = _level_db(s, "rms"), _level_db(s, "peak")
                if msg.src is not None and msg.src.get_name() == "pre":
                    if self.on_voice and rms:
                        self.on_voice(max(rms))
                elif self.on_level and rms and peak:
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
    """Polyphonic hotkey playback to the default output.

    Handles: one-shots, held (momentary) clips, toggled clips and seamless loops. Every live clip follows the
    hotkeys fader (`set_master_db`) and the ducking depth (`set_duck_db`) immediately, and the real signal
    level is reported through on_level(peak_db), so the meter shows what you actually hear.
    """

    def __init__(self, on_level=None):
        self._live: dict = {}          # pipeline -> {"vol", "base", "duck", "handle", "loop", "peak"}
        self.duck_db = 0.0
        self.master_db = 0.0
        self.on_level = on_level

    # -- gain that follows the fader and ducking live
    def _gain(self, c) -> float:
        g = c["base"] * 10 ** (self.master_db / 20)
        if c["duck"]:
            g *= 10 ** (self.duck_db / 20)
        return 0.0 if self.master_db <= -60 else g

    def _apply(self):
        for c in self._live.values():
            c["vol"].set_property("volume", min(self._gain(c), 10.0))

    def set_master_db(self, db: float):
        self.master_db = db
        self._apply()

    def set_duck_db(self, db: float):
        self.duck_db = db
        self._apply()

    # -- playback
    def play(self, path: Path, gain_db: float = 0.0, duck: bool = False, loop: bool = False, handle=None,
             sink: str = "pulsesink"):
        desc = (f"filesrc location=\"{path}\" ! decodebin ! audioconvert ! audioresample ! volume name=vol ! "
                f"level name=lvl interval=50000000 post-messages=true ! {sink}")
        try:
            pipe = Gst.parse_launch(desc)
        except GLib.Error:
            return None
        c = {"vol": pipe.get_by_name("vol"), "base": 10 ** (gain_db / 20), "duck": duck, "handle": handle,
             "loop": loop, "peak": -90.0}
        c["vol"].set_property("volume", min(self._gain(c), 10.0))
        self._live[pipe] = c
        bus = pipe.get_bus()
        bus.add_signal_watch()
        bus.connect("message", lambda _b, m, p=pipe: self._on_message(p, m))
        if loop:                                  # gapless: segment seeks instead of restarting on EOS
            pipe.set_state(Gst.State.PAUSED)
            pipe.get_state(2 * Gst.SECOND)
            pipe.seek(1.0, Gst.Format.TIME, Gst.SeekFlags.FLUSH | Gst.SeekFlags.SEGMENT, Gst.SeekType.SET, 0,
                      Gst.SeekType.NONE, -1)
        pipe.set_state(Gst.State.PLAYING)
        return pipe

    def _on_message(self, pipe, msg):
        c = self._live.get(pipe)
        if c is None:
            return
        t = msg.type
        if t == Gst.MessageType.SEGMENT_DONE and c["loop"]:
            pipe.seek(1.0, Gst.Format.TIME, Gst.SeekFlags.SEGMENT, Gst.SeekType.SET, 0, Gst.SeekType.NONE, -1)
        elif t == Gst.MessageType.ELEMENT:
            st = msg.get_structure()
            if st and st.get_name() == "level":
                peaks = _level_db(st, "peak")
                if peaks:
                    c["peak"] = max(peaks)
                    self._report()
        elif t in (Gst.MessageType.EOS, Gst.MessageType.ERROR):
            self._end(pipe)

    def _report(self):
        if self.on_level:
            self.on_level(max((c["peak"] for c in self._live.values()), default=-90.0))

    def _end(self, pipe):
        pipe.set_state(Gst.State.NULL)
        self._live.pop(pipe, None)
        self._report()

    def is_active(self, handle) -> bool:
        return any(c["handle"] == handle for c in self._live.values())

    def stop(self, handle, fade_ms: int = 25):
        """Stop every clip started by `handle`, with a short fade so a cut mid-waveform doesn't click."""
        for pipe, c in list(self._live.items()):
            if c["handle"] != handle:
                continue
            c["loop"] = False
            c["handle"] = None                                    # no longer "active" for toggles
            start, steps = c["vol"].get_property("volume"), 5

            def step(i=[0], pipe=pipe, vol=c["vol"], start=start):
                i[0] += 1
                if pipe not in self._live:
                    return False
                if i[0] >= steps:
                    self._end(pipe)
                    return False
                vol.set_property("volume", start * (1 - i[0] / steps))
                return True

            GLib.timeout_add(max(1, fade_ms // steps), step)

    def stop_all(self):
        for p in list(self._live):
            p.set_state(Gst.State.NULL)
        self._live.clear()
        self._report()


class Player:
    """In-app playback of a recorded file: play, pause, seek, position. Replaces launching an external player."""

    def __init__(self, on_eos=None, on_error=None, sink: str = "autoaudiosink"):
        self.on_eos, self.on_error = on_eos, on_error
        self.pipe = Gst.ElementFactory.make("playbin", "preview")
        self.pipe.set_property("video-sink", Gst.ElementFactory.make("fakesink", None))
        self.pipe.set_property("audio-sink", Gst.parse_bin_from_description(sink, True))
        bus = self.pipe.get_bus()
        bus.add_signal_watch()
        bus.connect("message", self._on_message)
        self.path: Path | None = None
        self._playing = False

    @property
    def playing(self) -> bool:
        return self._playing

    def load(self, path: Path, position: float = 0.0) -> bool:
        """Open a file paused at `position` seconds. Returns False if it can't be decoded."""
        self.pipe.set_state(Gst.State.NULL)
        self._playing = False
        self.path = Path(path)
        self.pipe.set_property("uri", Gst.filename_to_uri(str(self.path)))
        self.pipe.set_state(Gst.State.PAUSED)
        ok, state, _ = self.pipe.get_state(3 * Gst.SECOND)            # wait for the file to be opened
        if ok == Gst.StateChangeReturn.FAILURE:
            return False
        if position > 0:
            self.seek(position)
        return True

    def play(self):
        if self.path:
            self.pipe.set_state(Gst.State.PLAYING)
            self._playing = True

    def pause(self):
        self.pipe.set_state(Gst.State.PAUSED)
        self._playing = False

    def toggle(self):
        self.pause() if self._playing else self.play()

    def stop(self):
        self.pipe.set_state(Gst.State.NULL)
        self._playing = False
        self.path = None

    def seek(self, seconds: float):
        dur = self.duration()
        if dur:
            seconds = min(max(seconds, 0.0), max(dur - 0.05, 0.0))
        self.pipe.seek_simple(Gst.Format.TIME, Gst.SeekFlags.FLUSH | Gst.SeekFlags.ACCURATE, int(seconds * Gst.SECOND))

    def position(self) -> float:
        ok, pos = self.pipe.query_position(Gst.Format.TIME)
        return pos / Gst.SECOND if ok else 0.0

    def duration(self) -> float | None:
        ok, dur = self.pipe.query_duration(Gst.Format.TIME)
        return dur / Gst.SECOND if ok and dur > 0 else None

    def set_volume(self, v: float):
        self.pipe.set_property("volume", max(0.0, min(1.5, v)))

    def _on_message(self, bus, msg):
        if msg.type == Gst.MessageType.EOS:
            self._playing = False
            self.pipe.set_state(Gst.State.PAUSED)
            self.seek(0.0)
            if self.on_eos:
                self.on_eos()
        elif msg.type == Gst.MessageType.ERROR:
            err, _dbg = msg.parse_error()
            self._playing = False
            self.pipe.set_state(Gst.State.NULL)
            if self.on_error:
                self.on_error(err.message)


def read_audio(path: Path):
    """Decode any audio file to (float64 array of shape (n, channels), sample rate).

    libsndfile is tried first because it is quick for WAV. Some builds of it (the Flatpak runtime's) can't read MP3,
    so anything it refuses is decoded with GStreamer instead."""
    import tempfile
    import numpy as np
    import soundfile as sf
    try:
        data, sr = sf.read(str(path), dtype="float64", always_2d=True)
        return data, sr
    except Exception:
        pass
    with tempfile.TemporaryDirectory(prefix="podstudio-decode-") as td:
        wav = Path(td) / "decoded.wav"
        desc = (f'filesrc location="{path}" ! decodebin ! audioconvert ! audio/x-raw,format=F32LE,channels=2 ! '
                f'wavenc ! filesink location="{wav}"')
        pipe = Gst.parse_launch(desc)
        pipe.set_state(Gst.State.PLAYING)
        msg = pipe.get_bus().timed_pop_filtered(300 * Gst.SECOND, Gst.MessageType.EOS | Gst.MessageType.ERROR)
        pipe.set_state(Gst.State.NULL)
        if msg is None or msg.type == Gst.MessageType.ERROR:
            raise RuntimeError(f"couldn't decode {Path(path).name}" + (f": {msg.parse_error()[0].message}" if msg else ""))
        data, sr = sf.read(str(wav), dtype="float64", always_2d=True)
    return np.asarray(data), sr


def _peaks_from_array(data, bins: int):
    import numpy as np
    mono = data.mean(axis=1)
    total = len(mono)
    if total == 0:
        return np.zeros((bins, 2))
    hop = max(1, -(-total // bins))
    n = -(-total // hop)
    padded = np.pad(mono, (0, n * hop - total), mode="edge")
    r = padded.reshape(n, hop)
    peaks = np.stack([r.min(axis=1), r.max(axis=1)], axis=1)
    if len(peaks) < bins:
        peaks = np.concatenate([peaks, np.zeros((bins - len(peaks), 2))])
    return peaks[:bins]


def compute_peaks(path: Path, bins: int = 1600):
    """Waveform summary: (bins, 2) array of per-bin (min, max) in [-1, 1], mono-mixed. Constant memory."""
    import numpy as np
    import soundfile as sf
    try:
        info = sf.info(str(path))
    except Exception:                                        # a format libsndfile here can't read (MP3 in a Flatpak)
        return _peaks_from_array(read_audio(path)[0], bins)
    total = info.frames
    if total <= 0:
        return np.zeros((bins, 2))
    hop = max(1, -(-total // bins))                          # frames per bin (ceil)
    out_min, out_max = [], []
    with sf.SoundFile(str(path)) as f:
        while True:
            blk = f.read(hop * 4096, dtype="float32", always_2d=True)
            if len(blk) == 0:
                break
            mono = blk.mean(axis=1)
            full = len(mono) // hop * hop
            if full:
                r = mono[:full].reshape(-1, hop)
                out_min.append(r.min(axis=1)); out_max.append(r.max(axis=1))
            if len(mono) > full:                                # tail shorter than one bin
                out_min.append(np.array([mono[full:].min()])); out_max.append(np.array([mono[full:].max()]))
    mn, mx = np.concatenate(out_min), np.concatenate(out_max)
    peaks = np.stack([mn, mx], axis=1)
    if len(peaks) < bins:
        peaks = np.concatenate([peaks, np.zeros((bins - len(peaks), 2))])
    return peaks[:bins]


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
