<div align="center">

<img src="data/io.github.thetylerwoodwardproject.PodStudio.svg" width="112" alt="PodStudio icon">

# PodStudio

**A recording console for the RØDE PodMic USB.**<br>
Record, fire hotkey sounds on their own track, clean up the noise, export a podcast-loudness master, and send it to Buzzsprout as a private draft.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-informational?style=flat-square)
![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)

<img src="docs/screenshots/session.png" width="760" alt="Console with dBFS meters, a recorder, and eight hotkey pads">

</div>

> **Unofficial.** Not affiliated with, endorsed by, or sponsored by RØDE Microphones. "RØDE" and "PodMic" are trademarks of
> their owner, used only to describe the hardware this works with. PodStudio works with the **PodMic USB only**.

## Download

Get the installer from **[Releases](https://github.com/thetylerwoodwardproject/podstudio/releases)**.

| | |
|---|---|
| **Windows 10 / 11** | [`PodStudio-<version>-x64-setup.exe`](https://github.com/thetylerwoodwardproject/podstudio/releases/tag/v2026.11.20-8) (15 MB). Windows may warn that the installer is unsigned: choose *More info*, then *Run anyway*. |
| **Linux** (Ubuntu / Pop!_OS 24.04+) | The `.deb`, Flatpak or AppImage in [this release](https://github.com/thetylerwoodwardproject/podstudio/releases/tag/v2026.11.20-7). |

The Windows app is new and has **not yet been tried with a real PodMic on Windows**. Sessions are saved in `Music/PodStudio` and open in both apps.

## What it does

- **Record** 48 kHz, 24-bit from the PodMic, with live dBFS meters. A take is kept if the mic is unplugged or the app crashes.
- **Hotkey pads**: eight pads, each with a key, sound and mode (one-shot, hold, toggle, loop). They go on their own track.
- **Ducking** lowers chosen pads under your voice, live and in the master.
- **Master**: stereo, −16 LUFS, true peak ≤ −1 dBTP, with optional [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) noise reduction.
- **Recordings**: waveform player for every stem, with hotkey hits and chapters.
- **Script**: a notes page with a teleprompter.
- **Mic**: the PodMic's on-board processing, without RØDE Central.
- **Publish**: MP3 export, then a private Buzzsprout draft with cover art and chapters. Going public is a separate, confirmed step.

<div align="center">
<img src="docs/screenshots/recordings.png" width="380" alt="Recordings"> <img src="docs/screenshots/mix.png" width="380" alt="Mix">
</div>

## Using it

1. Plug in the PodMic. The header shows **PodMic connected**.
2. Click a pad (or right-click to edit) to choose its sound, key and mode.
3. **Ctrl+R** starts and stops recording. Press a pad's key at any time.
4. When you stop, the master is rendered. Adjust settings on **Mix** and render again if you like.
5. Listen on **Recordings**, then upload from **Publish**.

Pad keys work while PodStudio is focused (no system-wide hotkeys yet).

## Linux notes

The Mic tab needs a one-time permission for the mic's control channel. The `.deb` sets it up; for the Flatpak or AppImage run:

```bash
sudo install -m644 data/70-podstudio-podmic.rules /etc/udev/rules.d/ \
  && sudo udevadm control --reload && sudo udevadm trigger --subsystem-match=hidraw
```

`podstudio --self-test` checks an install.

## Build from source

- **Windows app** (C++): see [native/README.md](native/README.md).
- **Linux app** (Python + GTK): `./packaging/build-deb.sh`, `./packaging/build-appimage.sh`, or `./install.sh`. See [packaging/README.md](packaging/README.md).
- Tests: `python -m pytest` (Linux app) and `native/tests` (Windows app).

Releases are published by CI: push a commit whose message contains `[release]` (or a `v*` tag) after raising `packaging/revision`.

## Credits

PodMic protocol and tables from [podmicusb-doctor](https://github.com/rumkit/podmicusb-doctor) (MIT). Noise reduction by
[DeepFilterNet](https://github.com/Rikorose/DeepFilterNet). Loudness follows ITU-R BS.1770-4. See [NOTICE](NOTICE). MIT licensed.
