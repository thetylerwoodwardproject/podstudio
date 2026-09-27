# A WAV with a steady hiss (about −42 dBFS) added: noisy.py in.wav out.wav. Seeded, so the same every time.
import array, random, sys, wave
w = wave.open(sys.argv[1]); p = w.getparams(); data = w.readframes(p.nframes); w.close()
assert p.sampwidth == 2
a = array.array('h'); a.frombytes(data)
random.seed(1)
amp = 10 ** (-42 / 20) * 32768 * 1.7
out = array.array('h', [max(-32768, min(32767, int(v + random.uniform(-amp, amp)))) for v in a])
o = wave.open(sys.argv[2], 'w'); o.setparams(p); o.writeframes(out.tobytes()); o.close()
