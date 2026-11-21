# PodStudio for Windows

`PodStudio-<version>-x64-setup.exe` installs PodStudio for the current user (no administrator prompt) and adds a Start
menu entry. `PodStudio-<version>-x64-portable.zip` is the same folder to unzip anywhere and run `bin\PodStudio.exe`.
Windows 10 or 11, 64-bit.

> **Status: builds in CI and passes its headless self-test; not yet run with a window or a PodMic.** On 2026-11-21 the `windows`
> job in GitHub Actions built the app folder, ran `PodStudio-console.exe --self-test` on it with MSYS2 off `PATH` (GTK 4.24,
> libadwaita 1.10, GStreamer 1.28, numpy/scipy/soundfile, MP3 export, DeepFilterNet, hidapi, Credential Manager and the
> gain interfaces all passed), then built the installer and portable zip. The first Windows runs also caught several
> bundler gaps, now fixed. **Never done: installing it, opening the window, or recording with a real PodMic on Windows.**
> The checklist at the bottom says what to verify, in order. Steps 1 is done; start at 2.

## How it is built

PodStudio is a GTK 4 / libadwaita / GStreamer program, so the Windows build ships those libraries rather than rewriting the
interface. They come from [MSYS2](https://www.msys2.org)'s UCRT64 environment.

| Step | File | What it does |
|---|---|---|
| 1 | `build.sh` | Run in an MSYS2 UCRT64 shell. Compiles the launcher, fetches DeepFilterNet, runs the bundler, then runs `--self-test` on the result and zips it. |
| 2 | `bundle.py` | Copies Python, the app, GTK, libadwaita, only the GStreamer plugins PodStudio uses, typelibs, icons, schemas, and every DLL they need (found with `ntldd`) into `dist\PodStudio-<version>\`. |
| 3 | `podstudio.iss` | Inno Setup script that turns that folder into the installer. |
| – | `build-windows.ps1` | Does 1 to 3 on a Windows machine that has MSYS2 and Inno Setup. |
| – | `launcher.c`, `podstudio.rc`, `podstudio.ico` | `PodStudio.exe` (no console) and `PodStudio-console.exe` (prints to a terminal). They start the bundled Python on `-m podstudio`, so the program has its own name and icon. |
| – | `fetch-deepfilter.sh` | Downloads DeepFilterNet's Windows `deep-filter.exe` and checks it against a pinned SHA-256. |

CI: the `windows` job in `packaging/ci/packages.yml` does all of this on a GitHub runner and attaches the installer, the zip and
their `.sha256` files to the release. That workflow file is not active yet (see `HANDOFF.md`).

Build it yourself on Windows:

```powershell
# once: install MSYS2 (https://www.msys2.org) and Inno Setup 6 (https://jrsoftware.org/isinfo.php), then in an MSYS2 UCRT64 shell
#   run the pacman command at the top of packaging/windows/build.sh
powershell -ExecutionPolicy Bypass -File packaging\windows\build-windows.ps1
```

## What differs from Linux

| | Linux | Windows |
|---|---|---|
| Audio in / out | PulseAudio or PipeWire (`pulsesrc`, `pulsesink`) | WASAPI (`wasapi2src`, `autoaudiosink`). The mic is found through GStreamer's device list; its WASAPI endpoint id is its name. |
| Mic's on-board controls | `/dev/hidraw*`, needs a udev rule | HID through [hidapi](https://github.com/libusb/hidapi) (`libhidapi-0.dll`, bound with ctypes in `podstudio/hidapi.py`). No driver or rule needed. A USB device can expose several HID interfaces, so `PodMic.open()` tries them, vendor-defined first, and uses the first that answers. |
| Input gain | ALSA mixer | Windows audio endpoint volume (`podstudio/winaudio.py`, via `comtypes` and the interface definitions in `pycaw`). The 22 to 63 dB slider is mapped linearly onto the range Windows reports for the device. |
| Buzzsprout token | libsecret keyring | Windows Credential Manager (`podstudio/credentials.py`, ctypes). |
| Updates | the `.deb`, through `pkexec` | The installer. The app downloads it from the release, checks the published SHA-256, then closes, runs the installer silently for the current user and is reopened by it. Only a copy installed by the setup program (it has `unins000.exe`) does this; the portable zip links to the release page. |
| Noise reduction | static Linux `deep-filter` | static Windows `deep-filter.exe` |
| Settings, sessions | `~/.config/podstudio`, `~/Music/PodStudio` | `%APPDATA%\podstudio\config.json`, `Music\PodStudio` in your profile |
| Logs | terminal | `%LOCALAPPDATA%\PodStudio\podstudio.log` (the window has no console) |
| Global hotkeys | not implemented | not implemented: pad keys work while PodStudio is focused |

## Things to know

- **SmartScreen.** The installer is not code-signed, so Windows shows "Windows protected your PC" the first time. *More info*,
  then *Run anyway*. Signing needs a code-signing certificate, which this project does not have. Until it does, the published
  `.sha256` is how you check the download.
- **GPU or remote-desktop trouble.** If the window is blank or the app closes at once, start it with
  `set GSK_RENDERER=cairo` (a command prompt, then `bin\PodStudio.exe`) and read the log above.
- **RØDE Central.** If it is open it may hold the mic's control channel. Close it, then unplug and replug the mic.
- `PodStudio-console.exe --self-test` runs the same install check as on Linux and prints the result.

## First-run checklist (nobody has done this yet)

1. (Done in CI.) CI (or `build-windows.ps1`) gets through `build.sh`. Its last step is `--self-test` on the bundle with MSYS2 off `PATH`, which
   proves that the DLLs, typelibs, GStreamer plugins and DeepFilterNet were all bundled.
2. The installer installs, the Start menu entry opens a window, and `podstudio.log` has no tracebacks.
3. With a PodMic USB plugged in: the header says **PodMic USB connected** and the meter moves. Record 10 seconds; check
   `mic.wav` is 48 kHz, 24-bit and plays back.
4. Pads play sound out of the default output, and Hold, Toggle and Loop modes behave.
5. **Mic tab:** do the toggles (mute, monitoring, high-pass) change the mic, and read back after a restart? If the Mic tab says the
   controls "didn't answer", the HID interface choice in `hid_candidates()` is the first suspect. Does the **gain slider** move
   Windows' own Sound settings level? The dB mapping in `winaudio.py` is a guess until then.
6. Render a master with noise reduction on; export the MP3; check the loudness check passes.
7. Buzzsprout: save a token, restart, and confirm it is still connected (Credential Manager); upload a private draft.
8. Updater: install an older build, then publish a newer release and use **Check for Updates…**.
