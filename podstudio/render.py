"""Offline rendering: hotkey stem, master mix and loudness normalization."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from .project import SAMPLE_RATE, Project

TRUE_PEAK_LIMIT_DB = -1.0   # podcast delivery ceiling (dBTP); Apple, Spotify and EBU guidance all use -1


def db_to_lin(db: float) -> float:
    return 10 ** (db / 20)


def lin_to_db(x: float) -> float:
    return 20 * np.log10(max(x, 1e-12))


def read_stereo(path: Path) -> np.ndarray:
    data, sr = sf.read(str(path), dtype="float64", always_2d=True)
    if sr != SAMPLE_RATE:
        raise ValueError(f"{path.name}: expected {SAMPLE_RATE} Hz, got {sr}")
    if data.shape[1] == 1:
        data = np.repeat(data, 2, axis=1)
    return data[:, :2]


def write_wav24(path: Path, data: np.ndarray):
    sf.write(str(path), np.clip(data, -1.0, 1.0), SAMPLE_RATE, subtype="PCM_24")


DUCK_ATTACK_MS = 40.0
_HOP = 480                                  # 10 ms analysis hop at 48 kHz


def voice_duck_gain(mic: np.ndarray, amount_db: float, threshold_db: float,
                    release_ms: float, attack_ms: float = DUCK_ATTACK_MS) -> np.ndarray:
    """Per-sample linear gain that dips by `amount_db` while the mic is above `threshold_db` (RMS).

    Offline, so it can look ahead: the dip starts one attack-time before the voice, instead of letting the
    first syllable through.
    """
    mono = mic.mean(axis=1) if mic.ndim > 1 else mic
    n = len(mono) // _HOP
    if n == 0:
        return np.ones(len(mono))
    rms_db = 10 * np.log10((mono[: n * _HOP].reshape(n, _HOP) ** 2).mean(axis=1) + 1e-12)
    target = np.where(rms_db > threshold_db, -abs(amount_db), 0.0)
    look = max(1, int(round(attack_ms / 10)))
    target = np.concatenate([target[look:], np.full(look, target[-1])])        # look-ahead
    a_att = np.exp(-1.0 / max(attack_ms / 10, 0.1))
    a_rel = np.exp(-1.0 / max(release_ms / 10, 0.1))
    gain = np.empty(n)
    cur = 0.0
    for i in range(n):
        coef = a_att if target[i] < cur else a_rel                              # going down = attack, up = release
        cur = target[i] + (cur - target[i]) * coef
        gain[i] = cur
    centers = (np.arange(n) + 0.5) * _HOP
    curve = np.interp(np.arange(len(mono)), centers, gain)
    return 10 ** (curve / 20)


def render_hotkeys(project: Project, length_s: float | None = None, split: bool = False):
    """Place every logged hotkey hit on a stereo timeline the length of the mic take.

    With split=True returns (plain, duckable) so the mix can duck only the pads that asked for it."""
    if length_s is None:
        length_s = project.mic_duration
    total = max(int(round(length_s * SAMPLE_RATE)), 1)
    plain, duckable = np.zeros((total, 2)), np.zeros((total, 2))
    cache: dict[str, np.ndarray] = {}
    for ev in project.events:
        clip_path = project.clips_dir / ev.clip
        if not clip_path.exists():
            continue
        if ev.clip not in cache:
            cache[ev.clip] = read_stereo(clip_path)
        clip = cache[ev.clip] * db_to_lin(ev.gain_db)
        start = int(round(ev.t * SAMPLE_RATE))
        if start >= total:
            continue
        end = min(start + len(clip), total)
        (duckable if getattr(ev, "duck", False) else plain)[start:end] += clip[: end - start]
    return (plain, duckable) if split else plain + duckable


def limit(x: np.ndarray, ceiling_db: float = TRUE_PEAK_LIMIT_DB, lookahead_ms: float = 5.0) -> np.ndarray:
    """Small look-ahead peak limiter so normalizing up never clips."""
    ceil = db_to_lin(ceiling_db)
    peak = np.max(np.abs(x), axis=1)
    if peak.max() <= ceil:
        return x
    gain = np.minimum(1.0, ceil / np.maximum(peak, 1e-12))
    n = max(1, int(SAMPLE_RATE * lookahead_ms / 1000))
    # min-filter then smooth, so the gain dips before the peak and recovers gently
    padded = np.pad(gain, (n, n), constant_values=1.0)
    win = np.lib.stride_tricks.sliding_window_view(padded, 2 * n + 1)
    g = win.min(axis=1)
    kernel = np.hanning(2 * n + 1)
    kernel /= kernel.sum()
    g = np.convolve(np.pad(g, (n, n), mode="edge"), kernel, mode="valid")[: len(x)]
    return x * np.minimum(g, 1.0)[:, None]


def true_peak_db(x: np.ndarray, oversample: int = 4, chunk: int = 1 << 20) -> float:
    """ITU-R BS.1770 style true peak: 4x oversampled, measured in chunks to bound memory."""
    from scipy.signal import resample_poly
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    pad = 64
    for start in range(0, len(x), chunk):
        seg = x[max(0, start - pad): start + chunk + pad]
        up = resample_poly(seg, oversample, 1, axis=0)
        peak = max(peak, float(np.max(np.abs(up[pad * oversample: -pad * oversample or None]))))
    return lin_to_db(peak)


def integrated_lufs(x: np.ndarray) -> float | None:
    from . import loudness
    return loudness.integrated_loudness(x, SAMPLE_RATE)


@dataclass
class MasterResult:
    path: Path
    measured_lufs: float | None
    final_lufs: float | None
    gain_db: float
    true_peak_db: float
    limited: bool
    denoised: bool = False
    notes: tuple = ()
    ducked: bool = False


def normalize(mix: np.ndarray, target_lufs: float, ceiling_db: float = TRUE_PEAK_LIMIT_DB):
    """Gain to the loudness target, then limit until the true peak is under the ceiling.

    Returns (audio, measured_lufs, gain_db, final_lufs, true_peak_db, limited).
    """
    measured = integrated_lufs(mix)
    gain_db = 0.0 if measured is None else target_lufs - measured
    scaled = mix * db_to_lin(gain_db)
    out, limited, ceil = scaled, False, ceiling_db
    for _ in range(5):
        out = limit(scaled, ceil)
        limited = limited or out is not scaled
        tp = true_peak_db(out)
        if tp <= ceiling_db:
            break
        sample_peak = lin_to_db(float(np.max(np.abs(out))))
        ceil = min(ceil, sample_peak) - (tp - ceiling_db) - 0.05      # true peaks sit above sample peaks
    return out, measured, gain_db, integrated_lufs(out), true_peak_db(out), limited


def mix_master(project: Project, progress=None) -> MasterResult:
    """mic (mono -> centre) + hotkeys, faders applied, then normalized to project.target_lufs / -1 dBTP."""
    def tick(msg):
        if progress:
            progress(msg)

    notes, denoised, mic_path = [], False, project.mic_path
    if project.denoise:
        from . import denoise
        if denoise.available():
            try:
                mic_path = denoise.ensure_clean(project, progress)
                denoised = True
            except denoise.DenoiseError as e:                    # never lose the render over a cleanup problem
                notes.append(f"Noise reduction skipped: {e}")
        else:
            notes.append("DeepFilterNet isn't installed, so the master was rendered without noise reduction.")
    tick("Reading mic take")
    mic = read_stereo(mic_path)
    tick("Rendering hotkey track")
    hk_plain, hk_duck = render_hotkeys(project, len(mic) / SAMPLE_RATE, split=True)
    write_wav24(project.hotkeys_path, hk_plain + hk_duck)          # the stem stays un-ducked
    ducked = bool(np.any(hk_duck))
    if ducked:
        tick("Ducking hotkeys under your voice")
        g = voice_duck_gain(mic, project.duck_amount_db, project.duck_threshold_db, project.duck_release_ms)
        hk_duck = hk_duck * g[: len(hk_duck), None]
    hk = hk_plain + hk_duck
    n = max(len(mic), len(hk))
    mix = np.zeros((n, 2))
    mix[: len(mic)] += mic * db_to_lin(project.mic_db)
    if not project.hotkeys_muted:
        mix[: len(hk)] += hk * db_to_lin(project.hotkeys_db)

    tick("Normalizing loudness and true peak")
    out, measured, gain_db, final, tp, limited = normalize(mix, project.target_lufs)
    tick("Writing master")
    write_wav24(project.master_path, out)
    return MasterResult(project.master_path, measured, final, gain_db, tp, limited, denoised, tuple(notes), ducked)


@dataclass
class Mp3Result:
    path: Path
    lufs: float | None
    true_peak_db: float
    retried: bool


def export_mp3(project: Project, bitrate: int = 128) -> Mp3Result:
    """Encode master.wav to MP3, then decode it again to check the lossy result still meets the ceiling.

    Lossy encoding can push true peaks up a little. If it lands above -1 dBTP, the master is re-limited
    with extra headroom and encoded once more.
    """
    from . import audio
    master = read_stereo(project.master_path)
    work = project.audio_dir / ".export-tmp.wav"
    retried = False
    for attempt in range(2):
        write_wav24(work, master)
        audio.encode_mp3(work, project.mp3_path, title=project.name, bitrate=bitrate)
        decoded, sr = sf.read(str(project.mp3_path), dtype="float64", always_2d=True)
        tp = true_peak_db(decoded[:, :2])
        if tp <= TRUE_PEAK_LIMIT_DB + 0.05 or attempt == 1:
            break
        retried = True
        master = limit(master, TRUE_PEAK_LIMIT_DB - (tp - TRUE_PEAK_LIMIT_DB) - 0.2)
    work.unlink(missing_ok=True)
    return Mp3Result(project.mp3_path, integrated_lufs(decoded[:, :2]), tp, retried)
