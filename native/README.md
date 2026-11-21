# PodStudio, native (C++)

A native rewrite of PodStudio for Windows. One self-contained `PodStudio.exe` of about 6 MB (the installer is about 15 MB):
no Python, GTK or GStreamer. It reads and writes the **same session folders** as the Python app (`project.json`, `audio/`,
`clips/`), so sessions open in either.

| Layer | What | Notes |
|---|---|---|
| `core/` | WAV I/O, BS.1770 loudness, true peak, limiter, ducking, master render, `project.json`, PodMic protocol, crash recovery, Buzzsprout client | No operating-system code. Builds and is tested on Linux and Windows. |
| `app/` | Dear ImGui interface, audio engine (miniaudio: WASAPI on Windows), WinHTTP, Credential Manager, Core Audio gain, HID, Media Foundation MP3 | `main_win32.cpp` is the app (Direct3D 11). `main_glfw.cpp` is a Linux **preview** build of the identical UI, used to look at the interface and take screenshots. |
| `tests/` | `core_tests`, `engine_tests`, `buzz_tests` | The core is compared with the Python implementation (below). |

## How it is checked

- **`core_tests`** reproduces the Python app's numbers: loudness, true peak, limiter, ducking and normalisation to about eight
  digits, a whole session's `master.wav` to within 2e-7 per sample, every PodMic DSP field's bytes, crash recovery, and the project
  file round trip. The reference data is made by the Python code itself: `python3 native/tests/make_reference.py <dir>`, then
  `core_tests <dir>`.
- **`buzz_tests`** drives the Buzzsprout client against a scripted fake server: drafts are always private, the token never goes to the
  storage host, nothing is retried blindly, errors in both formats.
- **`engine_tests`** records through the demo input and checks the file, the pad mixer (one-shot, loop, fader, mute) and live ducking.
- CI (`native-windows` in `.github/workflows/packages.yml`) builds with MSVC, runs the tests on Windows, starts the app and captures
  each page, and builds the installer and portable zip.

## Build

```bash
# Linux preview + tests (needs cmake, ninja, a C++17 compiler, libglfw3-dev, libasound2-dev)
cmake -S native -B build -G Ninja && cmake --build build
python3 native/tests/make_reference.py build/reference && build/core_tests build/reference && build/buzz_tests build && build/engine_tests build
PODSTUDIO_DEMO=1 build/PodStudioPreview --page 0          # a demo voice and a demo mic, no hardware needed

# Windows (Visual Studio 2022)
cmake -S native -B native/build -G "Visual Studio 17 2022" -A x64
cmake --build native/build --config Release --target PodStudio
```

## Not done yet (compared with the Python app)

- **Never run with a real PodMic.** The HID transport tries each of the mic's interfaces until one answers; which one that is on Windows,
  and the gain range Windows reports, are unknown until someone tries.
- No in-app updater, no rich-text script formatting (plain text with a teleprompter), no compressor/gate curve drawings on the Mic tab,
  no cover-art thumbnail, and the interface is English only.
- Global hotkeys: pad keys work while PodStudio is focused (same as the Python app).
- The installer is not code-signed, so Windows SmartScreen warns on first run.
