#!/usr/bin/env python3
"""Writes fixture.wav and expected.txt into the given folder, using the Python implementation as the reference.

    python3 native/tests/make_reference.py <dir>

The C++ test (core_tests) then has to reproduce these numbers. Needs numpy, scipy and soundfile.
"""
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "reference"))
from podstudio import loudness, render  # noqa: E402

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(1234)
R, secs = 48000, 20
t = np.arange(R * secs) / R
x = np.zeros((len(t), 2))
x[: 5 * R] = 0.03 * rng.standard_normal((5 * R, 2))                                   # quiet noise
seg = slice(8 * R, 14 * R)                                                             # loud, with sharp peaks
x[seg, 0] = 0.5 * np.sin(2 * np.pi * 997 * t[seg]) + 0.2 * rng.standard_normal(6 * R)
x[seg, 1] = 0.45 * np.sin(2 * np.pi * 1500 * t[seg] + 1) + 0.2 * rng.standard_normal(6 * R)
x[10 * R + 100 : 10 * R + 104, 0] = [0.9, -0.95, 0.95, -0.9]                           # inter-sample peak candidates
x[14 * R :] = 0.01 * rng.standard_normal((6 * R, 2))
x = np.clip(x, -0.98, 0.98)
sf.write(str(out / "fixture.wav"), x, R, subtype="PCM_24")
y, _ = sf.read(str(out / "fixture.wav"), dtype="float64", always_2d=True)               # what the C++ side will read

lines = []
def put(k, v): lines.append(f"{k} {v!r}" if not isinstance(v, float) else f"{k} {v:.10f}")

put("frames", len(y))
put("lufs", loudness.integrated_loudness(y))
put("true_peak_db", render.true_peak_db(y))
sample_peak = float(np.max(np.abs(y)))
put("sample_peak", sample_peak)

lim = render.limit(y.copy(), -6.0)                                                      # limiter at a hard ceiling
put("limit_max", float(np.max(np.abs(lim))))
put("limit_mean_abs", float(np.mean(np.abs(lim))))
put("limit_sum", float(np.sum(lim)))

g = render.voice_duck_gain(y, 12.0, -40.0, 400.0)
put("duck_mean", float(np.mean(g)))
put("duck_min", float(np.min(g)))
for i in (0, 1000, 120000, 400000, 700000, len(g) - 1):
    put(f"duck_at_{i}", float(g[i]))

res = render.normalize(y.copy(), -16.0)
put("norm_measured", res[1]); put("norm_gain_db", res[2]); put("norm_final_lufs", res[3])
put("norm_true_peak", res[4]); put("norm_limited", int(res[5]))
put("norm_out_mean_abs", float(np.mean(np.abs(res[0]))))
(out / "expected.txt").write_text("\n".join(lines) + "\n")
print("\n".join(lines))

# ---- a whole session: the Python app renders it, the C++ test must produce the same master.wav ----
import shutil
from podstudio.project import Event, Pad, Project  # noqa: E402

for name in ("sess_py", "sess_cpp"):
    shutil.rmtree(out / name, ignore_errors=True)
proj = Project.create("parity", parent=out)                 # -> out/parity
proj.pads = [Pad(key="1", clip="beep.wav", duck=True), Pad(key="2", clip="beep.wav", mode="loop")]
proj.denoise = False
proj.save()
mono = (0.12 * rng.standard_normal(12 * R) * (np.sin(2 * np.pi * 0.4 * np.arange(12 * R) / R) > -0.2)).astype(np.float64)
sf.write(str(proj.mic_path), mono, R, subtype="PCM_24")
proj.mic_duration = 12.0
tt = np.arange(int(1.5 * R)) / R
beep = np.stack([0.6 * np.sin(2 * np.pi * 440 * tt) * np.exp(-tt), 0.5 * np.sin(2 * np.pi * 660 * tt) * np.exp(-tt)], axis=1)
sf.write(str(proj.clips_dir / "beep.wav"), beep, R, subtype="PCM_24")
proj.events = [Event(t=0.5, pad=0, clip="beep.wav", gain_db=-3.0, duck=True),
               Event(t=3.25, pad=0, clip="beep.wav", gain_db=0.0, duck=True, dur=0.4),
               Event(t=5.0, pad=1, clip="beep.wav", gain_db=-9.0, loop=True, dur=2.7),
               Event(t=10.0, pad=1, clip="beep.wav", gain_db=-6.0, loop=True),           # loop with no end runs to the take's end
               Event(t=11.9, pad=0, clip="beep.wav", gain_db=0.0)]
proj.mic_db, proj.hotkeys_db, proj.target_lufs = -2.0, -1.5, -16.0
proj.save()
shutil.copytree(proj.root, out / "sess_cpp")
res = render.mix_master(proj)
shutil.move(str(proj.root), str(out / "sess_py"))
put("sess_measured", res.measured_lufs); put("sess_final", res.final_lufs); put("sess_true_peak", res.true_peak_db)
put("sess_gain_db", res.gain_db); put("sess_limited", int(res.limited)); put("sess_ducked", int(res.ducked))
(out / "expected.txt").write_text("\n".join(lines) + "\n")
print("\n".join(lines[-6:]))

# ---- PodMic protocol: every encoder and decoder, over a spread of values ----
from podstudio import podmic as pm  # noqa: E402

pl = []
cases = {("comp", "threshold"): [-60, -45.5, -24.9, -14, -3, 0], ("comp", "ratio"): [1.5, 1.99, 3, 4.5],
         ("comp", "attack"): [0.1, 0.69, 5, 30, 10], ("comp", "release"): [5, 20.9, 100, 200],
         ("comp", "gain"): [0, 1.98, 4.5, 9], ("gate", "threshold"): [-60, -38, -20, -3],
         ("gate", "attack"): [0.5, 5, 30, 100], ("gate", "hold"): [0.01, 0.305, 1.0], ("gate", "release"): [0.05, 0.2, 2.0],
         ("gate", "range"): [-60, -9, -1], ("gate", "hysteresis"): [0, 20, 55, 100],
         ("exciter", "harmonics"): [0, 69.8, 100], ("exciter", "tune"): [600, 3499, 5000],
         ("bottom", "drive"): [0, 64.7, 100], ("bottom", "tune"): [60, 90, 312]}
for (b, f), vals in cases.items():
    for v in vals:
        target, sub, enc = pm.ENCODERS[(b, f)]
        payload = enc(float(v))
        rep = pm.dsp_report(target, pm.OP_SET, sub, payload)
        dec = pm.decode_field(b, f, payload)
        pl.append(f"enc {b} {f} {float(v)!r} {rep.hex()} {payload.hex()} {dec!r}")
for param, op, args in [(pm.P_HPF, pm.P_SET, (1,)), (pm.P_HPF, pm.P_GET, ()), (pm.P_MUTE, pm.P_SET, (0,)), (pm.P_MONITOR, pm.P_SET, (1,)),
                        (pm.P_MONMIX, pm.P_SET, (91,)), (pm.P_SLIDER, pm.P_GET, (2,)), (pm.P_SLIDER, pm.P_SET, (1, 55)), (pm.P_ADVANCED, pm.P_SET, (1,))]:
    pl.append(f"par {param} {op} {','.join(map(str, args)) or '-'} {pm.param_report(param, op, *args).hex()}")
for d, s, p in [(0, 0, 0), (50, 50, 50), (100, 80, 25), (33.3, 66.6, 99)]:
    for b, f, v in pm.basic_to_advanced(d, s, p):
        pl.append(f"basic {d!r} {s!r} {p!r} {b} {f} {v!r}")
(out / "podmic.txt").write_text("\n".join(pl) + "\n")
print(len(pl), "podmic reference lines")
