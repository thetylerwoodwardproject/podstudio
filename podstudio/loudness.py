"""ITU-R BS.1770-4 integrated loudness (LUFS), 48 kHz stereo. Small and dependency-light (numpy + scipy)."""
from __future__ import annotations

import numpy as np
from scipy.signal import lfilter

# K-weighting at 48 kHz: stage 1 high-shelf, stage 2 high-pass (BS.1770-4 table coefficients)
_SHELF = (np.array([1.53512485958697, -2.69169618940638, 1.19839281085285]),
          np.array([1.0, -1.69065929318241, 0.73248077421585]))
_RLB = (np.array([1.0, -2.0, 1.0]), np.array([1.0, -1.99004745483398, 0.99007225036621]))
_BLOCK, _STEP = 0.400, 0.100          # seconds: 400 ms blocks, 75 % overlap
_ABS_GATE, _REL_GATE = -70.0, -10.0


def integrated_loudness(x: np.ndarray, rate: int = 48000) -> float | None:
    """Integrated loudness in LUFS, or None if the signal is too short or silent. x: (n,) or (n, 2) float."""
    if rate != 48000:
        raise ValueError("loudness.py is calibrated for 48 kHz audio")
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = x[:, None]
    block, step = int(round(_BLOCK * rate)), int(round(_STEP * rate))
    if len(x) < block:
        return None
    y = lfilter(*_RLB, lfilter(*_SHELF, x, axis=0), axis=0)
    # mean square per 400 ms block, per channel (cumulative sum keeps this O(n))
    csum = np.concatenate([np.zeros((1, y.shape[1])), np.cumsum(y * y, axis=0)])
    starts = np.arange(0, len(y) - block + 1, step)
    ms = (csum[starts + block] - csum[starts]) / block                    # (blocks, channels)
    with np.errstate(divide="ignore"):
        lk = -0.691 + 10 * np.log10(ms.sum(axis=1))                      # all channels weighted 1.0 (L/R)
    keep = lk > _ABS_GATE
    if not keep.any():
        return None
    rel = -0.691 + 10 * np.log10(ms[keep].sum(axis=1).mean()) + _REL_GATE
    keep &= lk > rel
    if not keep.any():
        return None
    return float(-0.691 + 10 * np.log10(ms[keep].sum(axis=1).mean()))
