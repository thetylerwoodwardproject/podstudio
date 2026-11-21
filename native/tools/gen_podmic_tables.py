#!/usr/bin/env python3
"""Regenerates native/core/podmic_tables.inc from podstudio/data/podmic-dsp-tables.json (run from the repo root)."""
import json

d = json.load(open("podstudio/data/podmic-dsp-tables.json"))
out = ["// Generated from podstudio/data/podmic-dsp-tables.json by native/tools/gen_podmic_tables.py. Do not edit.",
       "// Encoder tables from the podmicusb-doctor project (MIT, (c) 2026 rumkit), https://github.com/rumkit/podmicusb-doctor", ""]
for k, v in d["tables"].items():
    vals = [int(x, 16) for x in v["values"]]
    assert len(vals) == 256, (k, len(vals))
    out.append(f"static const uint32_t {k}[256] = {{")
    for i in range(0, 256, 8):
        out.append("    " + ", ".join(f"0x{x:08X}u" for x in vals[i:i + 8]) + ",")
    out.append("};")
open("native/core/podmic_tables.inc", "w").write("\n".join(out) + "\n")
