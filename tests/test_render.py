import numpy as np
import soundfile as sf

from cuebooth.project import SAMPLE_RATE, Event, Project
from cuebooth.render import integrated_lufs, mix_master, read_stereo, render_hotkeys


def _tone(sec, hz, amp, ch=1):
    t = np.arange(int(sec * SAMPLE_RATE)) / SAMPLE_RATE
    x = amp * np.sin(2 * np.pi * hz * t)
    return x if ch == 1 else np.stack([x] * ch, axis=1)


def _project(tmp_path, mic_amp=0.03):
    p = Project.create("test take", parent=tmp_path)
    sf.write(p.mic_path, _tone(12, 220, mic_amp), SAMPLE_RATE, subtype="PCM_24")
    sf.write(p.clips_dir / "beep.wav", _tone(0.5, 880, 0.5, 2), SAMPLE_RATE, subtype="PCM_24")
    p.mic_duration = 12.0
    p.events = [Event(t=2.0, pad=0, clip="beep.wav"), Event(t=11.8, pad=0, clip="beep.wav")]
    return p


def test_hotkeys_stem_is_placed_and_clipped_to_take(tmp_path):
    p = _project(tmp_path)
    hk = render_hotkeys(p)
    assert hk.shape == (12 * SAMPLE_RATE, 2)
    assert np.abs(hk[: 2 * SAMPLE_RATE - 10]).max() == 0          # silent before first hit
    assert np.abs(hk[2 * SAMPLE_RATE : 2 * SAMPLE_RATE + 1000]).max() > 0.1
    assert np.abs(hk[-100:]).max() > 0                             # second hit truncated, not dropped


def test_master_hits_target_and_keeps_stems_separate(tmp_path):
    p = _project(tmp_path)
    r = mix_master(p)
    assert abs(r.final_lufs - (-16.0)) < 0.5
    assert r.true_peak_db <= -0.95
    master, sr = sf.read(p.master_path)
    info = sf.info(p.master_path)
    assert (sr, info.channels, info.subtype) == (48000, 2, "PCM_24")
    # stems untouched by normalization
    assert sf.info(p.mic_path).channels == 1
    assert np.abs(sf.read(p.mic_path)[0]).max() < 0.05
    assert sf.info(p.hotkeys_path).channels == 2


def test_quiet_take_is_raised_and_hot_take_lowered(tmp_path):
    for amp in (0.005, 0.6):
        p = _project(tmp_path / str(amp), amp)
        assert abs(mix_master(p).final_lufs + 16) < 0.6


def test_project_roundtrip(tmp_path):
    p = _project(tmp_path)
    p.pads[0].clip = "beep.wav"
    p.save()
    q = Project.load(p.root)
    assert q.pads[0].clip == "beep.wav" and len(q.events) == 2 and q.target_lufs == -16.0


def test_true_peak_ceiling_is_enforced_on_hot_material(tmp_path):
    from cuebooth.render import true_peak_db
    p = _project(tmp_path, 0.9)                      # loud, peaky take: normalization must limit
    r = mix_master(p)
    master = read_stereo(p.master_path)
    assert true_peak_db(master) <= -0.95
    assert abs(r.final_lufs + 16) < 1.0


def test_true_peak_sees_intersample_overs():
    from cuebooth.render import true_peak_db
    t = np.arange(4800)
    x = np.sin(2 * np.pi * (SAMPLE_RATE / 4) * t / SAMPLE_RATE + np.pi / 4)  # fs/4 at 45deg: samples read 0.707 of true peak
    x = (x / np.max(np.abs(x))) * 0.5
    assert true_peak_db(np.stack([x, x], 1)) > 20 * np.log10(np.max(np.abs(x))) + 2.5


def test_mp3_export_meets_podcast_spec(tmp_path):
    from cuebooth.render import export_mp3
    p = _project(tmp_path, 0.2)
    mix_master(p)
    r = export_mp3(p)
    assert p.mp3_path.exists() and p.mp3_path.stat().st_size > 10_000
    assert abs(r.lufs + 16) < 1.0 and r.true_peak_db <= -0.9
