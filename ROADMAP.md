# Roadmap

## Next: macOS (Apple silicon)

Rebuild the app for Macs with an M-series chip.

- **Reuse:** the platform-neutral `native/core/` (loudness, limiter, ducking, project files, PodMic protocol) and the interface.
- **New for Mac:** graphics (Metal), audio (CoreAudio), USB control of the mic (IOKit HID), token storage (Keychain), MP3 export, a signed and notarized `.dmg`.
- **Testing:** on a real Mac with a PodMic USB.
