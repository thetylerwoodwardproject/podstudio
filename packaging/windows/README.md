# Windows build (Python + GTK), superseded

This is the earlier Windows build: the Python app bundled with GTK 4 and GStreamer from MSYS2. It is 218 MB and has been replaced by the native
C++ app in [`native/`](../../native/README.md). It stays here for reference and only builds on a manual CI run.

- `build.sh` (MSYS2 UCRT64 shell) makes the app folder and a portable zip; `build-windows.ps1` also runs Inno Setup.
- `bundle.py` copies Python, GTK, GStreamer plugins and their DLLs; `podstudio.iss` is the installer script.
- It was never run with a real PodMic.
