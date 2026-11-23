<div align="center">

# PodStudio

**A recording console for the RØDE PodMic USB.**<br>
Record, add hotkey sounds, clean up the noise, export a podcast master, and send it to Buzzsprout.

![Status](https://img.shields.io/badge/status-windows%20released-f59e0b?style=flat-square)
![Platforms](https://img.shields.io/badge/platforms-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-3b82f6?style=flat-square)
![C++17](https://img.shields.io/badge/C%2B%2B-17-a1a1aa?style=flat-square)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-22c55e?style=flat-square)](LICENSE)

[Download](#download) ·
[Features](#features) ·
[Roadmap](#roadmap) ·
[Docs](docs) ·
[Mockup](docs/mockup)

<img src="docs/mockup/screenshots/session-dark.png" width="820" alt="The redesigned Session screen, from the design mockup">

</div>

> [!NOTE]
> **Unofficial.** Not affiliated with or endorsed by RØDE Microphones. Works with the PodMic USB only.
> The images here are the design [mockup](docs/mockup) the native app is being restyled to match.

## Download

**[Get PodStudio from Releases](https://github.com/thetylerwoodwardproject/podstudio/releases)**

Windows today: download the `setup.exe` and run it. If Windows warns that it's unsigned, choose *More info*, then *Run anyway*. macOS and Linux are next (see the roadmap).

<img src="docs/images/screenshot.png" width="640" alt="The current Windows app"><br><sub>The current Windows app, before the redesign.</sub>

## Features

| | |
|---|---|
| 🎙️ **Record the PodMic** | 48 kHz, 24-bit, with live meters and a loudness (LUFS) meter. |
| 🎹 **Hotkey sounds** | Eight pads for sound effects, on their own track, with ducking under your voice. |
| ✨ **Clean master** | Renders a −16 LUFS master with optional noise reduction, and exports an MP3. |
| 📤 **Publish** | Plays back with chapters, and uploads a private draft to Buzzsprout. |
| 🎛️ **Mic control** | Controls the mic's on-board processing. |

<table>
  <tr>
    <td width="30%"><img src="docs/mockup/screenshots/mic-dark.png" alt="Advanced mic screen with tone and dynamics curves"></td>
    <td width="30%"><img src="docs/mockup/screenshots/mix-dark.png" alt="Mix screen"></td>
    <td width="30%"><img src="docs/mockup/screenshots/session-light.png" alt="Session screen, light theme"></td>
    <td width="10%"><img src="docs/mockup/screenshots/phone-session-dark.png" alt="Session on a phone"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Mic</b></sub></td>
    <td align="center"><sub><b>Mix</b></sub></td>
    <td align="center"><sub><b>Session (light)</b></sub></td>
    <td align="center"><sub><b>Phone</b></sub></td>
  </tr>
</table>

## Roadmap

| | |
|---|---|
| **Now** | **macOS** (Apple silicon): Metal, CoreAudio, IOKit, Keychain, a signed and notarized `.dmg`. |
| **Next** | **Linux** as a `.deb` for Debian and Ubuntu (and Mint, Pop!_OS). |
| **Later** | The sidebar redesign, an advanced mic screen, re-mastering old recordings, more podcast hosts (rss.com, transistor.fm), and a prompter that follows what you say. |

Full roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Documentation

- [Roadmap](docs/ROADMAP.md)
- [Mockup](docs/mockup), a clickable shadcn/ui design reference
- [Building from source](native/README.md)

## Credits

Third-party notices are in [NOTICE](NOTICE).

## Licence

[MIT](LICENSE).
