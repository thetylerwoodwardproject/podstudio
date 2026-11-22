# Roadmap

## Next: macOS (Apple silicon)

Rebuild the app for Macs with an M-series chip.

- **Reuse:** the platform-neutral `native/core/` (loudness, limiter, ducking, project files, PodMic protocol) and the interface.
- **New for Mac:** graphics (Metal), audio (CoreAudio), USB control of the mic (IOKit HID), token storage (Keychain), MP3 export, a signed and notarized `.dmg`.
- **Testing:** on a real Mac with a PodMic USB.

## Then: Linux (Flatpak)

Bring the native app to Linux as a Flatpak, so it runs on any distribution.

- **Reuse:** `native/core/`, the interface and the audio engine (miniaudio runs on PipeWire, PulseAudio and ALSA).
- **New for Linux:** an OpenGL window, USB control of the mic through hidraw, libcurl for web requests, the Secret portal for the Buzzsprout token, LAME for MP3 export.
- **Mic controls:** a Flatpak can't install the USB permission rule itself, so the app shows a one-time command to add it. Recording works without it; only the Mic tab's on-board controls need it.
- **Distribution:** a `.flatpak` bundle on Releases first, then Flathub, which handles updates.

## Design

- **shadcn-style redesign with a sidebar:** move the header tabs into a left sidebar (logo, Record button, sections, recent sessions, mic status) and restyle the native app to match the approved shadcn/ui mockup ([design/mockup](design/mockup)). On hold until after the current work.

## Recording and publishing

- **Old recordings:** open an earlier session, re-master it, and publish it to Buzzsprout.
- **Re-take tone:** add a 1 kHz tone to the recording as a marker for a re-take, so it's easy to find when editing.
- **More podcast hosts:** publish to rss.com and transistor.fm as well as Buzzsprout.

## Script and prompter

- **Hotkeys beside the script:** show the hotkey pads along the side of the script/prompter view.
- **Prompter that listens:** it follows the words you actually say, pauses during ad-libs, and resumes when you're back on the script.
