# PodStudio (C++)

A native C++17 app for Windows: one ~6 MB `PodStudio.exe` (15 MB installer).

| Folder | What |
|---|---|
| `core/` | Audio files, loudness, limiter, ducking, master render, session files, PodMic protocol, recovery, Buzzsprout, updater. No OS code. |
| `app/` | Dear ImGui interface, miniaudio (WASAPI), WinHTTP, Credential Manager, HID, MP3 (Media Foundation). |
| `tests/` | Core, engine, Buzzsprout, updater and Windows-only tests. |
| `reference/` | A small Python reference implementation that `core_tests` compares the C++ against. |

## Build and test

```bash
# Visual Studio 2022
cmake -S native -B native/build -G "Visual Studio 17 2022" -A x64
cmake --build native/build --config Release --target PodStudio
python native/tests/make_reference.py native/build/reference
native/build/Release/core_tests native/build/reference
```

`core_tests` checks loudness, the limiter, a whole session's master and every PodMic field against the reference. CI runs all tests, starts the app, and publishes releases.

## Not done yet

- No rich-text script formatting, compressor/gate curves or cover-art preview.
- The installer is unsigned.
