import wave, sys, math
f, a, b = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
w = wave.open(f); r = w.getframerate(); sw = w.getsampwidth()
w.setpos(int(a * r)); d = w.readframes(int((b - a) * r))
n = len(d) // sw
v = [int.from_bytes(d[i*sw:(i+1)*sw], 'little', signed=True) / (2 ** (8*sw - 1)) for i in range(0, n, 7)]
print(math.sqrt(sum(x*x for x in v) / max(1, len(v))))
