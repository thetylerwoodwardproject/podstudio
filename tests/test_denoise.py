import os
import stat
import sys

import numpy as np
import pytest
import soundfile as sf

from podstudio import denoise, loudness
from podstudio.project import SAMPLE_RATE, Event, Project
from podstudio.render import mix_master

FAKE = '''#!{py}
# Stand-in for upstream `deep-filter`: same CLI, same quirks (rejects 24-bit, writes 16-bit, trims the tail).
import sys, pathlib, soundfile as sf
args = sys.argv[1:]
out = pathlib.Path(args[args.index("-o") + 1]); src = pathlib.Path(args[-1])
pathlib.Path("{log}").open("a").write(" ".join(args) + "\\n")
if "{mode}" == "fail":
    print("boom", file=sys.stderr); sys.exit(101)
if sf.info(src).subtype != "FLOAT":
    print("called `Result::unwrap()` on an `Err` value: TooWide", file=sys.stderr); sys.exit(101)
x, sr = sf.read(src)
sf.write(out / src.name, x[:-1440] * 0.5, sr, subtype="PCM_16")
'''


def fake_binary(tmp_path, mode="ok"):
    exe, log = tmp_path / "deep-filter", tmp_path / "calls.log"
    exe.write_text(FAKE.format(py=sys.executable, log=log, mode=mode))
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    return exe, log


def make_project(tmp_path):
    p = Project.create("denoise test", parent=tmp_path / "proj")
    t = np.arange(12 * SAMPLE_RATE) / SAMPLE_RATE
    sf.write(p.mic_path, 0.05 * np.sin(2 * np.pi * 200 * t), SAMPLE_RATE, subtype="PCM_24")
    p.mic_duration = 12.0
    return p


def test_loudness_matches_the_bs1770_calibration_point():
    t = np.arange(10 * SAMPLE_RATE) / SAMPLE_RATE
    left = np.stack([np.sin(2 * np.pi * 997 * t), np.zeros_like(t)], 1)       # 0 dBFS, left channel only
    assert abs(loudness.integrated_loudness(left) - (-3.01)) < 0.05


def test_loudness_agrees_with_pyloudnorm():
    pyln = pytest.importorskip("pyloudnorm")
    rng = np.random.default_rng(0)
    t = np.arange(15 * SAMPLE_RATE) / SAMPLE_RATE
    x = np.stack([(np.sin(2 * np.pi * 1.1 * t) > 0) * 0.2 * np.sin(2 * np.pi * 180 * t)] * 2, 1) + 0.002 * rng.standard_normal((len(t), 2))
    assert abs(loudness.integrated_loudness(x) - pyln.Meter(SAMPLE_RATE).integrated_loudness(x)) < 0.1


def test_denoise_feeds_float_and_restores_length(tmp_path):
    exe, log = fake_binary(tmp_path)
    p = make_project(tmp_path)
    denoise.denoise(p.mic_path, p.clean_path, 18, binary=exe)
    a, b = sf.read(p.mic_path), sf.read(p.clean_path)
    assert len(b[0]) == len(a[0]) and b[1] == SAMPLE_RATE
    assert sf.info(p.clean_path).subtype == "PCM_24"
    assert "-a 18.0" in log.read_text() and "-D" in log.read_text()


def test_clean_copy_is_cached_until_take_or_strength_changes(tmp_path, monkeypatch):
    exe, log = fake_binary(tmp_path)
    monkeypatch.setenv("PODSTUDIO_DEEPFILTER", str(exe))
    p = make_project(tmp_path)
    denoise.ensure_clean(p); denoise.ensure_clean(p)
    assert len(log.read_text().splitlines()) == 1                  # second call reused mic-clean.wav
    p.denoise_atten_db = 30.0
    denoise.ensure_clean(p)
    assert len(log.read_text().splitlines()) == 2                  # new strength re-runs


def test_master_uses_cleaned_mic_and_keeps_raw_stem(tmp_path, monkeypatch):
    exe, _ = fake_binary(tmp_path)
    monkeypatch.setenv("PODSTUDIO_DEEPFILTER", str(exe))
    p = make_project(tmp_path)
    raw_before = p.mic_path.read_bytes()
    r = mix_master(p)
    assert r.denoised and not r.notes and p.clean_path.exists()
    assert p.mic_path.read_bytes() == raw_before                    # raw stem untouched
    assert abs(r.final_lufs + 16) < 0.6


def test_render_survives_missing_or_failing_binary(tmp_path, monkeypatch):
    p = make_project(tmp_path)
    monkeypatch.setenv("PODSTUDIO_DEEPFILTER", str(tmp_path / "nope"))
    monkeypatch.setattr(denoise, "find_binary", lambda: None)
    r = mix_master(p)
    assert not r.denoised and "isn't installed" in r.notes[0] and p.master_path.exists()
    bad, _ = fake_binary(tmp_path, "fail")
    monkeypatch.setattr(denoise, "find_binary", lambda: bad)
    r = mix_master(p)
    assert not r.denoised and "skipped" in r.notes[0] and p.master_path.exists()


@pytest.mark.skipif(not os.environ.get("PODSTUDIO_DEEPFILTER_REAL"), reason="set PODSTUDIO_DEEPFILTER_REAL to the real deep-filter")
def test_real_deepfilternet_reduces_steady_noise(tmp_path):
    rng = np.random.default_rng(3)
    t = np.arange(12 * SAMPLE_RATE) / SAMPLE_RATE
    noise = 0.02 * rng.standard_normal(len(t))
    sf.write(tmp_path / "in.wav", noise, SAMPLE_RATE, subtype="PCM_24")
    denoise.denoise(tmp_path / "in.wav", tmp_path / "out.wav", 18, binary=denoise.Path(os.environ["PODSTUDIO_DEEPFILTER_REAL"]))
    out, _ = sf.read(tmp_path / "out.wav")
    drop = 20 * np.log10(np.std(noise) / np.std(out[SAMPLE_RATE:]))
    assert 12 < drop < 24                                           # limited to ~18 dB
