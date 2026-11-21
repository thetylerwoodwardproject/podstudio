<div align="center">

<img src="data/io.github.thetylerwoodwardproject.PodStudio.svg" width="112" alt="PodStudio icon">

# PodStudio

**A recording console for the RØDE PodMic USB.**<br>
Record, add hotkey sounds, clean up the noise, export a podcast master, and send it to Buzzsprout.

<img src="docs/screenshots/session.png" width="760" alt="PodStudio">

</div>

> **Unofficial.** Not affiliated with or endorsed by RØDE Microphones. Works with the PodMic USB only.

## Download

**[Get PodStudio from Releases](https://github.com/thetylerwoodwardproject/podstudio/releases)**

- **Windows:** download the `setup.exe`. If Windows warns that it's unsigned, choose *More info*, then *Run anyway*.
- **Linux:** download the `.deb`, Flatpak or AppImage.

## What it does

- Records the PodMic at 48 kHz, 24-bit, with live meters.
- Eight hotkey pads for sound effects, on their own track, with ducking under your voice.
- Renders a −16 LUFS master with optional noise reduction, and exports an MP3.
- Plays back with chapters, and uploads a private draft to Buzzsprout.
- Controls the mic's on-board processing.

## Notes

- The Windows app is new and hasn't been tried with a real PodMic yet.
- Linux: the Mic tab needs a one-time permission, and the `.deb` sets it up. See [packaging/README.md](packaging/README.md).
- Building from source: see [native/README.md](native/README.md) (Windows) and [packaging/README.md](packaging/README.md) (Linux).

MIT licensed. Credits in [NOTICE](NOTICE).
