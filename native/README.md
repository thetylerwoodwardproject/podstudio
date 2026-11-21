# PodStudio for Windows (C++)

A native C++17 app: one ~6 MB `PodStudio.exe` (15 MB installer), no Python or GTK. It uses the same session folders as the Linux app.

| Folder | What |
|---|---|
| `core/` | Audio files, loudness, limiter, ducking, master render, session files, PodMic protocol, recovery, Buzzsprout, updater. No OS code. |
| `app/` | Dear ImGui interface, miniaudio (WASAPI), WinHTTP, Credential Manager, HID, MP3 (Media Foundation). `main_win32.cpp` is the app; `main_glfw.cpp` is a Linux preview used for screenshots. |
| `tests/` | Core, engine, Buzzsprout, updater and Windows-only tests. |

## Build and test

```bash
# Windows (Visual Studio 2022)
cmake -S native -B native/build -G "Visual Studio 17 2022" -A x64
cmake --build native/build --config Release --target PodStudio

# Linux preview + tests
cmake -S native -B build -G Ninja && cmake --build build
python3 native/tests/make_reference.py build/reference && build/core_tests build/reference
PODSTUDIO_DEMO=1 build/PodStudioPreview          # demo voice and mic, no hardware
```

`core_tests` compares the C++ with the Python app's output (loudness, limiter, a whole session's master, every PodMic field). CI runs all tests on Windows, starts the app, and publishes releases.

## Not done yet

- Never used with a real PodMic. Which HID interface carries the controls, and the gain range Windows reports, are unknown.
- No rich-text script formatting, compressor/gate curves or cover-art preview.
- The installer is unsigned.
