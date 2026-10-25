#!/usr/bin/env bash
# Runs the long solo-recording test DETACHED from your terminal/session, so it keeps
# going if you disconnect (setsid + nohup: its own session, parent = init). Only a
# server reboot stops it.
#   validation/recording/run-long.sh 120      # 2-hour run (default 30)
# Progress/result:  tail -f ~/.local/state/podstudio/long-test/run.log
#                   cat ~/.local/state/podstudio/long-test/long-test.result   (appears when done)
set -euo pipefail
MINUTES="${1:-30}"
here="$(cd "$(dirname "$0")" && pwd)"
work="$HOME/.local/state/podstudio/long-test"
mkdir -p "$work"
cd "$work"
# playwright-core (uses the Chromium already in ~/.cache/ms-playwright)
if [ ! -d node_modules/playwright-core ]; then
  [ -f package.json ] || echo '{"name":"podstudio-long-test","private":true,"type":"module"}' > package.json
  npm install --silent playwright-core
fi
# deterministic fake microphone: 10 s of a swelling 220/440 Hz tone, 48 kHz mono, looped by Chromium
python3 - <<'PY'
import wave, struct, math
sr=48000
w=wave.open("mic-test.wav","wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
f=bytearray()
for i in range(sr*10):
    env=0.5+0.5*math.sin(2*math.pi*0.7*i/sr)
    v=0.1*env*math.sin(2*math.pi*220*i/sr)+0.03*env*math.sin(2*math.pi*440*i/sr)
    f+=struct.pack("<h",int(v*32767))
w.writeframes(bytes(f)); w.close()
PY
cp "$here/long-test.mjs" .
rm -f long-test.result
echo "[$(date -Is)] starting ${MINUTES}-minute run (pid file: run.pid)" > run.log
MINUTES="$MINUTES" WORK_DIR="$work" setsid nohup timeout $(( MINUTES * 60 + 3600 )) node long-test.mjs >> run.log 2>&1 < /dev/null &
echo $! > run.pid
echo "started; follow with: tail -f $work/run.log"
