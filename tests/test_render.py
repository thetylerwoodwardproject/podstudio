import numpy as np
import soundfile as sf

from podstudio.project import SAMPLE_RATE, Event, Project
from podstudio.render import integrated_lufs, mix_master, read_stereo, render_hotkeys


def _tone(sec, hz, amp, ch=1):
    t = np.arange(int(sec * SAMPLE_RATE)) / SAMPLE_RATE
    x = amp * np.sin(2 * np.pi * hz * t)
    return x if ch == 1 else np.stack([x] * ch, axis=1)


def _project(tmp_path, mic_amp=0.03):
    p = Project.create("test take", parent=tmp_path)
    sf.write(p.mic_path, _tone(12, 220, mic_amp), SAMPLE_RATE, subtype="PCM_24")
    sf.write(p.clips_dir / "beep.wav", _tone(0.5, 880, 0.5, 2), SAMPLE_RATE, subtype="PCM_24")
    p.mic_duration = 12.0
    p.denoise = False                  # synthetic tones are not speech; keep these tests independent of DeepFilterNet
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
    from podstudio.render import true_peak_db
    p = _project(tmp_path, 0.9)                      # loud, peaky take: normalization must limit
    r = mix_master(p)
    master = read_stereo(p.master_path)
    assert true_peak_db(master) <= -0.95
    assert abs(r.final_lufs + 16) < 1.0


def test_true_peak_sees_intersample_overs():
    from podstudio.render import true_peak_db
    t = np.arange(4800)
    x = np.sin(2 * np.pi * (SAMPLE_RATE / 4) * t / SAMPLE_RATE + np.pi / 4)  # fs/4 at 45deg: samples read 0.707 of true peak
    x = (x / np.max(np.abs(x))) * 0.5
    assert true_peak_db(np.stack([x, x], 1)) > 20 * np.log10(np.max(np.abs(x))) + 2.5


def test_mp3_export_meets_podcast_spec(tmp_path):
    from podstudio.render import export_mp3
    p = _project(tmp_path, 0.2)
    mix_master(p)
    r = export_mp3(p)
    assert p.mp3_path.exists() and p.mp3_path.stat().st_size > 10_000
    assert abs(r.lufs + 16) < 1.0 and r.true_peak_db <= -0.9


def test_repair_wav_header_recovers_unfinished_take(tmp_path):
    import struct
    from podstudio.audio import repair_wav_header
    p = tmp_path / "mic.wav"
    sf.write(p, _tone(2, 220, 0.2), SAMPLE_RATE, subtype="PCM_24")
    raw = bytearray(p.read_bytes())
    raw[4:8] = struct.pack("<I", 0)                     # sizes as left by a writer that never finished
    di = raw.index(b"data") + 4
    raw[di:di + 4] = struct.pack("<I", 0)
    raw += b"\x01"                                      # plus a torn final sample
    p.write_bytes(bytes(raw))
    dur = repair_wav_header(p)
    assert abs(dur - 2.0) < 0.01
    data, sr = sf.read(p)
    assert sr == SAMPLE_RATE and abs(len(data) / sr - 2.0) < 0.01


def test_podmic_source_detection(monkeypatch):
    import json, subprocess
    from podstudio import audio
    sources = [
        {"name": "alsa_input.pci-0000_64_00.6.HiFi__Mic1__source", "properties": {}},
        {"name": "alsa_output.usb-X.monitor", "properties": {"device.vendor.id": "0x19f7", "device.product.id": "0x004a"}},
        {"name": "alsa_input.usb-Other_Mic-00.mono-fallback", "properties": {"device.vendor.id": "0x1234", "device.product.id": "0x0001"}},
        {"name": "alsa_input.usb-R__DE_R__DE_PodMic_USB_XXXX-00.mono-fallback",
         "properties": {"device.vendor.id": "0x19f7", "device.product.id": "0x004a"}},
    ]
    fake = lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout=json.dumps(sources))
    monkeypatch.setattr(subprocess, "run", fake)
    assert audio.find_podmic_source().endswith("PodMic_USB_XXXX-00.mono-fallback")
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout=json.dumps(sources[:3])))
    assert audio.find_podmic_source() is None            # other mics and monitors are never picked
