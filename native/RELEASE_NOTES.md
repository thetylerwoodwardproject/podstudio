**PodStudio for Windows, rewritten in C++.** One small installer (about 15 MB) with no Python, GTK or GStreamer. It opens the same session folders as the Linux app.

Unofficial. Not affiliated with or endorsed by RØDE. It works with the PodMic USB only.

## Install (Windows 10 or 11, 64-bit)

Download **`PodStudio-<version>-x64-setup.exe`** below and run it. It installs for your user with no administrator prompt, upgrades over the earlier Python build of PodStudio if you have it, and never touches your sessions in `Music\PodStudio`.

The installer isn't code-signed, so Windows SmartScreen shows "Windows protected your PC" the first time: choose **More info**, then **Run anyway**. Each file has a `.sha256` next to it if you want to check the download. `…-portable.zip` is the same app to unzip anywhere and run, with no installer.

## What it does

Record the PodMic with live meters, fire hotkey sounds from pads onto their own track (one-shot, hold, toggle, loop, with ducking under your voice), render a −16 LUFS master with optional DeepFilterNet noise reduction, export an MP3, listen back with chapters, keep a script with a teleprompter, control the mic's on-board processing, and upload a private draft to Buzzsprout. A take that was interrupted by a crash or power cut can be recovered when you next open the app.

## Not tried for real yet

- **Never used with a real PodMic on Windows.** Which of the mic's USB control interfaces carries its settings, and the gain range Windows reports, are untested.
- Buzzsprout upload and the in-app updater have only run against test servers, not a live account or release.
- The Linux packages are not part of this release.

Checked automatically on Windows for every build: the audio maths matches the original app to within a millionth, MP3 export, secure web requests, saved-token storage, and that the app starts and draws its window.
