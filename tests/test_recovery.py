import json
import struct

import numpy as np
import pytest
import soundfile as sf

from podstudio import recovery
from podstudio.project import SAMPLE_RATE as SR, Event, Project, list_sessions
from podstudio.recovery import Journal, RecoveryError, replay
from podstudio.render import mix_master


def killed_wav(path, seconds=6.0):
    """Exactly what a killed GStreamer recording leaves: placeholder sizes in the header and a torn final sample."""
    t = np.arange(int(seconds * SR)) / SR
    sf.write(path, 0.2 * np.sin(2 * np.pi * 220 * t), SR, subtype="PCM_24")
    raw = bytearray(path.read_bytes())
    raw[4:8] = struct.pack("<I", 0x7FFF0024)
    i = raw.index(b"data") + 4
    raw[i:i + 4] = struct.pack("<I", 0x7FFF0000)
    raw += b"\x07"
    path.write_bytes(bytes(raw))


def interrupted(tmp_path, with_journal=True):
    p = Project.create("Crash test", parent=tmp_path)
    p.recording = True
    p.save()
    killed_wav(p.mic_path)
    sf.write(p.clips_dir / "horn.wav", np.zeros((SR // 2, 2)) + 0.1, SR, subtype="PCM_24")
    if with_journal:
        j = Journal(p.journal_path); j.start()
        j.hit(0, Event(t=1.0, pad=0, clip="horn.wav", gain_db=-3.0, duck=True))
        j.hit(1, Event(t=2.5, pad=1, clip="horn.wav", loop=True)); j.end(1, 2.0)
        j.hit(2, Event(t=4.0, pad=2, clip="horn.wav", loop=True))          # still looping when the app died
        with open(p.journal_path, "a") as f:
            f.write('{"op": "hit", "i": 3, "t": 5.')                         # the crash tore this line in half
    return p


def test_journal_roundtrips_and_survives_a_torn_last_line(tmp_path):
    p = interrupted(tmp_path)
    ev = replay(p.journal_path)
    assert [(e.t, e.pad, e.duck, e.loop, e.dur) for e in ev] == [(1.0, 0, True, False, None), (2.5, 1, False, True, 2.0),
                                                                 (4.0, 2, False, True, None)]
    assert ev[0].gain_db == -3.0
    assert replay(tmp_path / "nothing.jsonl") == []


def test_a_crashed_recording_comes_back_with_its_hits(tmp_path):
    p = interrupted(tmp_path)
    assert list_sessions(tmp_path)[0]["status"] == "interrupted"
    r = recovery.recover(p.root)
    assert r.seconds == pytest.approx(6.0, abs=0.05)
    pr = Project.load(p.root)
    assert pr.recording is False and pr.mic_duration == pytest.approx(6.0, abs=0.05)
    assert len(pr.events) == 3 and pr.events[1].dur == 2.0 and pr.events[2].dur is None and pr.events[2].loop
    assert any("Recovered 0:06" in n for n in r.notes) and any("3 hotkey hits" in n for n in r.notes)
    info = sf.info(p.mic_path)
    assert info.frames == pytest.approx(6 * SR, abs=2) and not p.journal_path.exists()
    assert list_sessions(tmp_path)[0]["status"] == "ok"
    assert mix_master(pr).final_lufs is not None                              # and it renders like any other session


def test_recovery_without_a_journal_still_saves_the_audio(tmp_path):
    p = interrupted(tmp_path, with_journal=False)
    r = recovery.recover(p.root)
    assert r.seconds == pytest.approx(6.0, abs=0.05) and Project.load(p.root).events == []


def test_hits_past_the_end_of_the_audio_are_dropped(tmp_path):
    p = interrupted(tmp_path)
    with open(p.journal_path, "a") as f:
        f.write("\n" + json.dumps({"op": "hit", "i": 9, "t": 999.0, "pad": 0, "clip": "horn.wav"}) + "\n")
    assert all(e.t < 7 for e in recovery.recover(p.root).project.events)


def test_every_save_keeps_a_backup_of_the_last_good_file(tmp_path):
    p = Project.create("backup", parent=tmp_path)
    p.mic_db = -3.0; p.save()
    p.mic_db = -6.0; p.save()
    assert json.loads((p.root / "project.json.bak").read_text())["mic_db"] == -3.0     # one save behind


def test_a_damaged_session_file_is_restored_from_the_backup(tmp_path):
    p = Project.create("Precious", parent=tmp_path)
    p.mic_db, p.episode = -4.0, {"title": "Ep 9"}; p.save()
    p.save()                                                                           # the .bak now holds the good copy
    p.file.write_text('{"name": "Preci')                                               # power cut mid-write
    assert list_sessions(tmp_path)[0]["status"] == "damaged"
    r = recovery.recover(p.root)
    q = Project.load(p.root)
    assert q.name == "Precious" and q.mic_db == -4.0 and q.episode == {"title": "Ep 9"}
    assert any("automatic backup" in n for n in r.notes)
    assert list(p.root.glob("project.json.damaged-*"))                                 # the broken file is kept, not deleted


def test_a_missing_session_file_is_rebuilt_from_the_audio_and_hits(tmp_path):
    p = interrupted(tmp_path)
    p.file.unlink()
    (p.root / "project.json.bak").unlink(missing_ok=True)
    assert list_sessions(tmp_path)[0]["status"] == "damaged"
    r = recovery.recover(p.root)
    q = Project.load(p.root)
    assert q.name == "Crash test" and q.mic_duration == pytest.approx(6.0, abs=0.05) and len(q.pads) == 8
    assert q.pads[0].clip == "horn.wav" and q.pads[1].clip == "horn.wav"               # pads inferred from the hits
    assert any("rebuilt" in n for n in r.notes)


def test_a_folder_with_nothing_in_it_is_not_a_session(tmp_path):
    (tmp_path / "random-folder").mkdir()
    assert list_sessions(tmp_path) == []
    with pytest.raises(RecoveryError):
        recovery.recover(tmp_path / "random-folder")


def test_recovering_a_healthy_session_changes_nothing_important(tmp_path):
    p = Project.create("Fine", parent=tmp_path)
    t = np.arange(3 * SR) / SR
    sf.write(p.mic_path, 0.1 * np.sin(2 * np.pi * 200 * t), SR, subtype="PCM_24")
    p.mic_duration, p.mic_db = 3.0, -2.0; p.save()
    r = recovery.recover(p.root)
    assert Project.load(p.root).mic_db == -2.0 and not r.notes
