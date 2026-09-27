# Independent BS.1770-4 integrated loudness and sample peak of a WAV file (pure Python).
import sys, wave, math, struct
def read(path):
    w = wave.open(path); ch = w.getnchannels(); sw = w.getsampwidth(); rate = w.getframerate()
    raw = w.readframes(w.getnframes()); n = len(raw) // (sw * ch)
    if sw == 2:
        vals = struct.unpack('<%dh' % (n * ch), raw); scale = 32768.0
    elif sw == 3:
        vals = [int.from_bytes(raw[i:i+3], 'little', signed=True) for i in range(0, len(raw), 3)]; scale = 8388608.0
    return rate, ch, [[vals[f * ch + c] / scale for f in range(n)] for c in range(ch)]
def coeffs(rate):
    f0 = 1681.974450955533; G = 3.999843853973347; Q = 0.7071752369554196
    K = math.tan(math.pi * f0 / rate); Vh = 10 ** (G / 20); Vb = Vh ** 0.4996667741545416
    a0 = 1 + K / Q + K * K
    s = ((Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0)
    f0 = 38.13547087602444; Q = 0.5003270373238773; K = math.tan(math.pi * f0 / rate); a0 = 1 + K / Q + K * K
    h = (1.0, -2.0, 1.0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0)
    return s, h
def filt(x, c):
    b0, b1, b2, a1, a2 = c; y = [0.0] * len(x); x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, o; y[i] = o
    return y
rate, ch, chans = read(sys.argv[1])
s, h = coeffs(rate)
z = [filt(filt(x, s), h) for x in chans]
n = len(z[0]); step = int(0.1 * rate); blk = 4 * step
sq = [sum(z[c][i] ** 2 for c in range(ch)) for i in range(n)]
pref = [0.0]
for v in sq: pref.append(pref[-1] + v)
blocks = [(pref[i + blk] - pref[i]) / blk for i in range(0, n - blk + 1, step)]
L = lambda e: -0.691 + 10 * math.log10(e) if e > 0 else -1e9
a = [e for e in blocks if L(e) > -70]
rel = L(sum(a) / len(a)) - 10
g = [e for e in a if L(e) > rel]
peak = max(abs(v) for x in chans for v in x)
print('%.2f %.2f %d %d' % (L(sum(g) / len(g)), 20 * math.log10(peak), ch, rate))
