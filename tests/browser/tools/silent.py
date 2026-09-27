import wave, sys
w = wave.open(sys.argv[1]); r = w.getframerate(); sw = w.getsampwidth(); c = w.getnchannels(); n = w.getnframes(); d = w.readframes(n)
best = (0, 0); run = 0; start = 0
for i in range(n):
    o = i * c * sw
    if d[o:o + sw] == b'\0' * sw:
        if run == 0: start = i
        run += 1
        if run > best[1] - best[0]: best = (start, start + run)
    else: run = 0
print(best[0] / r, best[1] / r)
