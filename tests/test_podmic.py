import struct

from podstudio import podmic as p


def test_spec_worked_examples():
    assert p.dsp_report(0, 2, 2, p.ENCODERS[("comp", "ratio")][2](2.48))[:5] == bytes([4, 0, 2, 2, 0x53])
    r = p.dsp_report(1, 2, 1, p.ENCODERS[("gate", "threshold")][2](-40))
    assert r[:8] == bytes([4, 1, 2, 1, 0x14, 0xAE, 0x47, 0x01]) and len(r) == 29
    assert p.param_report(0x0D, 0, 1)[:4] == bytes([8, 0x0D, 0, 1]) and len(p.param_report(1, 0)) == 28


def test_captured_gate_values():
    assert p.gate_hold_or_release(0.05) == bytes.fromhex("40a70d00")
    assert p.gate_hold_or_release(0.2) == bytes.fromhex("d0690300")
    assert abs(struct.unpack("<i", p.gate_hyst(20))[0] - 0x61191200) < 1000   # float32 vs double
    assert p.gate_thr_or_range(0) == bytes.fromhex("ffffff7f")                  # saturated


def test_tables_and_endpoints():
    t = p.tables()
    assert all(len(v) == 256 for v in t.values())
    assert t["T_thr"][0] == 0 and t["T_thr"][255] == 0x7FFD0000
    assert p.idx_thr(0) == 0 and p.idx_thr(-60) == 255


def test_biquad_matches_spec_example():
    req = p.hpf_biquad_request(0, 150)
    assert req.hex() == "080700000000009f181e3fc2cec3819f181e3fd213397e57b1c0c101"


def test_basic_mode_matches_factory_defaults():
    adv = {(b, f): v for b, f, v in p.basic_to_advanced(75, 80, 70)}
    assert abs(adv[("comp", "threshold")] - (-25.2)) < 0.4        # factory -24.9
    assert abs(adv[("comp", "gain")] - 2.1) < 0.2                 # factory 1.98
    assert abs(adv[("exciter", "harmonics")] - 72) < 3            # factory 69.8


def test_decoders_invert_encoders():
    cases = [("comp", "threshold", -30.0, 0.5), ("comp", "ratio", 2.5, 0.05), ("comp", "attack", 1.0, 0.1),
             ("comp", "release", 50.0, 3.0), ("comp", "gain", 4.0, 0.1), ("gate", "threshold", -40.0, 0.1),
             ("gate", "range", -20.0, 0.1), ("gate", "hold", 0.3, 0.002), ("gate", "release", 1.0, 0.01),
             ("gate", "hysteresis", 20.0, 1.0), ("gate", "attack", 30.0, 0.5),
             ("exciter", "harmonics", 70.0, 0.5), ("exciter", "tune", 3500.0, 20),
             ("bottom", "drive", 65.0, 0.5), ("bottom", "tune", 90.0, 1.5)]
    for block, field, v, tol in cases:
        payload = p.ENCODERS[(block, field)][2](v)
        got = p.decode_field(block, field, payload)
        assert got is not None and abs(got - v) <= max(tol, abs(v) * 0.03), (block, field, v, got)


class _Capture(p.PodMic):
    """PodMic with the USB transfer replaced, so tests can see exactly what each setter sends."""
    def __init__(self):
        super().__init__(path="/dev/null")
        self.sent = []
    def _xfer(self, report, timeout=1.0):
        self.sent.append(bytes(report))
        return p.Reply("A", bytes([0, 0, 0, 0]))


def _wire(fn):
    m = _Capture()
    fn(m)
    return m.sent[-1].hex()


def test_setters_send_the_bytes_in_the_spec_examples():
    pad = lambda h, n=28: h.ljust(n * 2, "0")
    assert _wire(lambda m: m.set_processing(True)) == pad("080d0001")          # spec 13: "08 0D 00 01"
    assert _wire(lambda m: m.set_hpf(True)) == pad("08010001")                  # spec 13: "08 01 00 01"
    assert _wire(lambda m: m.set_monitoring(True)) == pad("08030001")           # value is byte 3, not byte 4
    assert _wire(lambda m: m.set_monitoring(False)) == pad("08030000")
    assert _wire(lambda m: m.set_mute(True)) == pad("08080001")
    assert _wire(lambda m: m.set_monitor_mix(91)) == pad("0804005b")
    assert _wire(lambda m: m.set_slider(2, 70)) == pad("080c000246")            # spec 5.4: [0x0C, 0, index, percent]
    assert _wire(lambda m: m.slider(1)) == pad("080c0101")                      # GET: [0x0C, 1, index]
