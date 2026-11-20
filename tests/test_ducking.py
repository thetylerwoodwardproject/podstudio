import numpy as np
import soundfile as sf

from podstudio.project import SAMPLE_RATE as SR, Event, Pad, Project
from podstudio.render import mix_master, read_stereo, voice_duck_gain

db = lambda x: 20 * np.log10(max(x, 1e-9))


def voice(total=10.0, on=(3.0, 6.0), amp=0.1):
    t = np.arange(int(total * SR)) / SR
    x = np.zeros_like(t)
    m = (t >= on[0]) & (t < on[1])
    x[m] = amp * np.sin(2 * np.pi * 180 * t[m])
    return np.stack([x, x], 1)


def test_gain_curve_dips_before_the_voice_and_recovers():
    g = voice_duck_gain(voice(), amount_db=12, threshold_db=-40, release_ms=350)
    at = lambda s: db(g[int(s * SR)])
    assert abs(at(1.0)) < 0.1                       # silence: untouched
    assert at(2.99) < -6                            # look-ahead: already dipping as the voice starts
    assert abs(at(4.5) + 12) < 0.5                  # mid-speech: the full 12 dB
    assert at(6.05) < -9 and abs(at(7.5)) < 0.5     # releases after the voice stops


def test_below_threshold_never_ducks():
    g = voice_duck_gain(voice(amp=0.0005), 12, -40, 350)         # about -66 dBFS: room noise
    assert np.allclose(g, 1.0, atol=1e-3)


def _project(tmp_path, duck_a, duck_b):
    p = Project.create("duck test", parent=tmp_path)
    sf.write(p.mic_path, voice()[:, 0], SR, subtype="PCM_24")
    tone = lambda f: np.stack([0.2 * np.sin(2 * np.pi * f * np.arange(10 * SR) / SR)] * 2, 1)
    sf.write(p.clips_dir / "bed.wav", tone(330), SR, subtype="PCM_24")
    sf.write(p.clips_dir / "fx.wav", tone(1250), SR, subtype="PCM_24")
    p.denoise = False                                # the sine 'voice' must reach the sidechain untouched
    p.mic_duration, p.mic_db = 10.0, -60.0          # mic nearly out of the mix, so the master is the hotkeys
    p.events = [Event(t=0, pad=0, clip="bed.wav", duck=duck_a), Event(t=0, pad=1, clip="fx.wav", duck=duck_b)]
    return p


def band_levels(path, f):
    """Level of one frequency during speech vs during a pause (isolates one pad in the master)."""
    x = read_stereo(path)[:, 0]
    w = np.hanning(SR)
    def at(s):
        seg = x[int(s * SR): int(s * SR) + SR] * w
        spec = np.abs(np.fft.rfft(seg)); return spec[int(f * len(seg) / SR)]
    return db(at(4.0) / at(8.0))                   # speech window / pause window


def test_only_pads_with_duck_enabled_dip(tmp_path):
    p = _project(tmp_path, duck_a=True, duck_b=False)
    r = mix_master(p)
    assert r.ducked
    assert abs(band_levels(p.master_path, 330) + 12) < 1.5       # ducked pad: about -12 dB while speaking
    assert abs(band_levels(p.master_path, 1250)) < 1.0           # plain pad: unchanged
    stem = read_stereo(p.hotkeys_path)[:, 0]                      # the stem is never ducked
    assert abs(db(np.std(stem[int(3.5*SR):int(5*SR)]) / np.std(stem[int(7.5*SR):int(9*SR)]))) < 0.2


def test_no_ducking_when_no_pad_asks_for_it(tmp_path):
    p = _project(tmp_path, False, False)
    assert not mix_master(p).ducked


def test_older_projects_load_without_duck_fields(tmp_path):
    p = Project.create("old", parent=tmp_path)
    import json
    d = json.loads(p.file.read_text())
    for pad in d["pads"]:
        pad.pop("duck", None)
    for k in ("duck_amount_db", "duck_threshold_db", "duck_release_ms"):
        d.pop(k, None)
    p.file.write_text(json.dumps(d))
    q = Project.load(p.root)
    assert q.pads[0].duck is False and q.duck_amount_db == 12.0
